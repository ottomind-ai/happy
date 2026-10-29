/**
 * Images that live on the session's machine, e.g. the PNG Codex's imagegen
 * saves and then references as `![alt](/Users/me/project/output/x.png)`.
 * The app can't open that path itself, so the file is read over the session's
 * file RPCs and shown as a data URI.
 *
 * Reads are size-checked first (listDirectory gives the size): the CLI answers
 * readFile with the whole file base64-encoded, encrypted and base64-encoded
 * again (~1.78x), and an answer above the server's 8 MiB socket limit
 * (happy-server socketConfig maxHttpBufferSize) would drop the CLI's socket.
 */
import { resolveSessionFilePath } from './sessionFileLinks';
import { sessionListDirectory, sessionReadFile } from '@/sync/ops';

/** 4 MiB of image is ~7.5 MB on the wire, under the server's 8 MiB limit. */
export const MAX_SESSION_IMAGE_BYTES = 4 * 1024 * 1024;

const IMAGE_MIME_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
};

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const FILE_URL = /^file:\/\//i;

export function sessionImageMimeType(path: string): string | null {
    const basename = path.split(/[\\/]/).pop() ?? '';
    const dot = basename.lastIndexOf('.');
    if (dot <= 0) {
        return null;
    }
    return IMAGE_MIME_TYPES[basename.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * Resolves a markdown image target to an absolute path on the session's
 * machine. Absolute paths, `file://` URLs and `~/` paths resolve on their own;
 * relative paths need the session root. Returns null for web/data URLs and
 * non-images, which render as before. Whether the CLI lets the app read the
 * file (only inside the session root) is left to the CLI.
 */
export function resolveSessionImagePath(url: string, sessionRoot: string | null | undefined): string | null {
    let target = url.trim();
    if (target.startsWith('<') && target.endsWith('>')) {
        target = target.slice(1, -1).trim();
    }
    if (!target) {
        return null;
    }
    if (URL_SCHEME.test(target) && !WINDOWS_ABSOLUTE_PATH.test(target) && !FILE_URL.test(target)) {
        return null;
    }
    if (!FILE_URL.test(target)) {
        // Markdown writers percent-encode spaces; file URLs are decoded by the resolver.
        try {
            target = decodeURIComponent(target);
        } catch {
            // Not percent-encoded; use as written.
        }
    }
    if (!sessionImageMimeType(target)) {
        return null;
    }
    return resolveSessionFilePath(target, sessionRoot)?.absolutePath ?? null;
}

/** Splits a path the CLI accepts (absolute, or relative to the session root). */
export function splitParentAndName(path: string): { parent: string; name: string } | null {
    const slash = path.lastIndexOf('/');
    const name = path.slice(slash + 1);
    if (!name) {
        return null;
    }
    if (slash < 0) {
        return { parent: '.', name };
    }
    let parent = path.slice(0, slash);
    if (parent === '') {
        parent = '/';
    } else if (/^[A-Za-z]:$/.test(parent)) {
        parent = `${parent}/`;
    }
    return { parent, name };
}

/** Decoded byte count of a base64 string, without decoding it. */
export function base64DecodedLength(base64: string): number {
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.floor((base64.length * 3) / 4) - padding;
}

export type SessionImageError =
    | { kind: 'tooLarge'; size: number }
    | { kind: 'failed'; message?: string };

export type SessionImageResult =
    | { ok: true; uri: string }
    | { ok: false; error: SessionImageError };

// Last read of each image, keyed by session and path. `version` is the file's
// size and mtime, so an image the agent regenerates under the same name is
// read again. Bounded by total data URI length (images are a few MB each).
const MAX_CACHE_CHARS = 16 * 1024 * 1024;
const cache = new Map<string, { version: string; uri: string }>();
let cachedChars = 0;
const inFlight = new Map<string, Promise<SessionImageResult>>();

function cacheKey(sessionId: string, path: string): string {
    return `${sessionId}\u0000${path}`;
}

function rememberInCache(key: string, version: string, uri: string) {
    const previous = cache.get(key);
    if (previous) {
        cache.delete(key);
        cachedChars -= previous.uri.length;
    }
    cache.set(key, { version, uri });
    cachedChars += uri.length;
    while (cachedChars > MAX_CACHE_CHARS && cache.size > 1) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cachedChars -= cache.get(oldest)!.uri.length;
        cache.delete(oldest);
    }
}

/** The last copy read of this image, for an instant first paint. */
export function peekSessionImage(sessionId: string, path: string): string | null {
    return cache.get(cacheKey(sessionId, path))?.uri ?? null;
}

async function readSessionImage(sessionId: string, path: string, key: string): Promise<SessionImageResult> {
    const mime = sessionImageMimeType(path);
    const location = splitParentAndName(path);
    if (!mime || !location) {
        return { ok: false, error: { kind: 'failed' } };
    }

    const listing = await sessionListDirectory(sessionId, location.parent);
    if (!listing.success || !listing.entries) {
        return { ok: false, error: { kind: 'failed', message: listing.error } };
    }
    const entry = listing.entries.find((e) => e.name === location.name && e.type === 'file');
    if (!entry) {
        return { ok: false, error: { kind: 'failed', message: 'File not found' } };
    }
    if (entry.size === undefined) {
        return { ok: false, error: { kind: 'failed', message: 'File size unknown' } };
    }
    if (entry.size > MAX_SESSION_IMAGE_BYTES) {
        return { ok: false, error: { kind: 'tooLarge', size: entry.size } };
    }

    const version = `${entry.size}:${entry.modified ?? ''}`;
    const cached = cache.get(key);
    if (cached?.version === version) {
        rememberInCache(key, version, cached.uri);
        return { ok: true, uri: cached.uri };
    }

    const response = await sessionReadFile(sessionId, path);
    if (!response.success || !response.content) {
        return { ok: false, error: { kind: 'failed', message: response.error } };
    }
    const size = base64DecodedLength(response.content);
    if (size > MAX_SESSION_IMAGE_BYTES) {
        return { ok: false, error: { kind: 'tooLarge', size } };
    }
    const uri = `data:${mime};base64,${response.content}`;
    rememberInCache(key, version, uri);
    return { ok: true, uri };
}

/** Reads an image from the session's machine; concurrent calls share one read. */
export function loadSessionImage(sessionId: string, path: string): Promise<SessionImageResult> {
    const key = cacheKey(sessionId, path);
    let promise = inFlight.get(key);
    if (!promise) {
        promise = readSessionImage(sessionId, path, key)
            .catch((error): SessionImageResult => ({
                ok: false,
                error: { kind: 'failed', message: error instanceof Error ? error.message : undefined },
            }))
            .finally(() => { inFlight.delete(key); });
        inFlight.set(key, promise);
    }
    return promise;
}

export function formatImageSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Test-only: forget cached reads. */
export function resetSessionImageCache() {
    cache.clear();
    cachedChars = 0;
    inFlight.clear();
}
