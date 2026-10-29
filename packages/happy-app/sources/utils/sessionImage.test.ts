import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sessionListDirectory, sessionReadFile } = vi.hoisted(() => ({
    sessionListDirectory: vi.fn(),
    sessionReadFile: vi.fn(),
}));
vi.mock('@/sync/ops', () => ({ sessionListDirectory, sessionReadFile }));

import {
    base64DecodedLength,
    formatImageSize,
    loadSessionImage,
    MAX_SESSION_IMAGE_BYTES,
    peekSessionImage,
    resetSessionImageCache,
    resolveSessionImagePath,
    sessionImageMimeType,
    splitParentAndName,
} from './sessionImage';

const sessionRoot = '/Users/ctx/temp';
const imagePath = '/Users/ctx/temp/output/imagegen/bulut-bahcivani.png';
const PNG_BASE64 = 'iVBORw0KGgo=';

function listing(entries: { name: string; type?: 'file' | 'directory'; size?: number; modified?: number }[]) {
    return {
        success: true,
        entries: entries.map((e) => ({ type: 'file' as const, ...e })),
    };
}

describe('sessionImageMimeType', () => {
    it('maps image extensions, case-insensitively', () => {
        expect(sessionImageMimeType('a/b.png')).toBe('image/png');
        expect(sessionImageMimeType('a/b.JPG')).toBe('image/jpeg');
        expect(sessionImageMimeType('b.jpeg')).toBe('image/jpeg');
        expect(sessionImageMimeType('b.webp')).toBe('image/webp');
        expect(sessionImageMimeType('b.gif')).toBe('image/gif');
    });

    it('rejects other files', () => {
        expect(sessionImageMimeType('b.svg')).toBeNull();
        expect(sessionImageMimeType('b.ts')).toBeNull();
        expect(sessionImageMimeType('png')).toBeNull();
        expect(sessionImageMimeType('.png')).toBeNull();
        expect(sessionImageMimeType('dir.png/file')).toBeNull();
    });
});

describe('resolveSessionImagePath', () => {
    it('keeps absolute paths', () => {
        expect(resolveSessionImagePath(imagePath, sessionRoot)).toBe(imagePath);
        expect(resolveSessionImagePath(imagePath, null)).toBe(imagePath);
    });

    it('resolves paths relative to the session root', () => {
        expect(resolveSessionImagePath('output/imagegen/bulut-bahcivani.png', sessionRoot)).toBe(imagePath);
        expect(resolveSessionImagePath('./output/imagegen/bulut-bahcivani.png', sessionRoot)).toBe(imagePath);
    });

    it('needs the session root for relative paths', () => {
        expect(resolveSessionImagePath('output/imagegen/bulut-bahcivani.png', null)).toBeNull();
    });

    it('accepts file URLs, home paths, angle brackets and percent-encoding', () => {
        expect(resolveSessionImagePath('file:///Users/ctx/temp/output/a%20b.png', sessionRoot)).toBe('/Users/ctx/temp/output/a b.png');
        expect(resolveSessionImagePath('~/temp/output/x.png', sessionRoot)).toBe('/Users/ctx/temp/output/x.png');
        expect(resolveSessionImagePath('</Users/ctx/temp/a b.png>', sessionRoot)).toBe('/Users/ctx/temp/a b.png');
        expect(resolveSessionImagePath('output/a%20b.png', sessionRoot)).toBe('/Users/ctx/temp/output/a b.png');
        expect(resolveSessionImagePath('output/100%.png', sessionRoot)).toBe('/Users/ctx/temp/output/100%.png');
    });

    it('accepts Windows paths', () => {
        expect(resolveSessionImagePath('C:\\work\\out\\x.png', 'C:\\work')).toBe('C:/work/out/x.png');
    });

    it('leaves web and data URLs and non-images alone', () => {
        expect(resolveSessionImagePath('https://example.com/x.png', sessionRoot)).toBeNull();
        expect(resolveSessionImagePath('http://example.com/x.png', sessionRoot)).toBeNull();
        expect(resolveSessionImagePath('data:image/png;base64,AAAA', sessionRoot)).toBeNull();
        expect(resolveSessionImagePath('/Users/ctx/temp/notes.md', sessionRoot)).toBeNull();
        expect(resolveSessionImagePath('  ', sessionRoot)).toBeNull();
    });
});

describe('splitParentAndName', () => {
    it('splits absolute and relative paths', () => {
        expect(splitParentAndName(imagePath)).toEqual({ parent: '/Users/ctx/temp/output/imagegen', name: 'bulut-bahcivani.png' });
        expect(splitParentAndName('/x.png')).toEqual({ parent: '/', name: 'x.png' });
        expect(splitParentAndName('C:/x.png')).toEqual({ parent: 'C:/', name: 'x.png' });
        expect(splitParentAndName('out/x.png')).toEqual({ parent: 'out', name: 'x.png' });
        expect(splitParentAndName('x.png')).toEqual({ parent: '.', name: 'x.png' });
        expect(splitParentAndName('/dir/')).toBeNull();
    });
});

describe('base64DecodedLength', () => {
    it('matches the decoded byte count', () => {
        for (const text of ['', 'a', 'ab', 'abc', 'abcd', 'hello world!']) {
            expect(base64DecodedLength(btoa(text))).toBe(text.length);
        }
    });
});

describe('formatImageSize', () => {
    it('formats KB and MB', () => {
        expect(formatImageSize(200)).toBe('1 KB');
        expect(formatImageSize(512 * 1024)).toBe('512 KB');
        expect(formatImageSize(5.25 * 1024 * 1024)).toBe('5.3 MB');
    });
});

describe('loadSessionImage', () => {
    beforeEach(() => {
        resetSessionImageCache();
        sessionListDirectory.mockReset();
        sessionReadFile.mockReset();
    });

    it('checks the size, reads the file and returns a data URI', async () => {
        sessionListDirectory.mockResolvedValue(listing([
            { name: 'other.png', size: 10 },
            { name: 'bulut-bahcivani.png', size: 8, modified: 1 },
        ]));
        sessionReadFile.mockResolvedValue({ success: true, content: PNG_BASE64 });

        const result = await loadSessionImage('s1', imagePath);

        expect(result).toEqual({ ok: true, uri: `data:image/png;base64,${PNG_BASE64}` });
        expect(sessionListDirectory).toHaveBeenCalledWith('s1', '/Users/ctx/temp/output/imagegen');
        expect(sessionReadFile).toHaveBeenCalledWith('s1', imagePath);
        expect(peekSessionImage('s1', imagePath)).toBe(`data:image/png;base64,${PNG_BASE64}`);
        expect(peekSessionImage('s2', imagePath)).toBeNull();
    });

    it('does not read files over the size limit', async () => {
        sessionListDirectory.mockResolvedValue(listing([
            { name: 'bulut-bahcivani.png', size: MAX_SESSION_IMAGE_BYTES + 1 },
        ]));

        const result = await loadSessionImage('s1', imagePath);

        expect(result).toEqual({ ok: false, error: { kind: 'tooLarge', size: MAX_SESSION_IMAGE_BYTES + 1 } });
        expect(sessionReadFile).not.toHaveBeenCalled();
    });

    it('rejects a read that grew past the limit after the size check', async () => {
        sessionListDirectory.mockResolvedValue(listing([{ name: 'bulut-bahcivani.png', size: 8 }]));
        const big = 'A'.repeat(Math.ceil((MAX_SESSION_IMAGE_BYTES + 3) / 3) * 4);
        sessionReadFile.mockResolvedValue({ success: true, content: big });

        const result = await loadSessionImage('s1', imagePath);

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.kind).toBe('tooLarge');
        expect(peekSessionImage('s1', imagePath)).toBeNull();
    });

    it('reports a missing file, a directory with that name, and RPC errors', async () => {
        sessionListDirectory.mockResolvedValueOnce(listing([{ name: 'else.png', size: 1 }]));
        expect(await loadSessionImage('s1', imagePath)).toEqual({ ok: false, error: { kind: 'failed', message: 'File not found' } });

        sessionListDirectory.mockResolvedValueOnce(listing([{ name: 'bulut-bahcivani.png', type: 'directory' }]));
        expect(await loadSessionImage('s1', imagePath)).toEqual({ ok: false, error: { kind: 'failed', message: 'File not found' } });

        const denied = "Access denied: Path '/elsewhere' is outside the working directory";
        sessionListDirectory.mockResolvedValueOnce({ success: false, error: denied });
        expect(await loadSessionImage('s1', '/elsewhere/x.png')).toEqual({ ok: false, error: { kind: 'failed', message: denied } });

        sessionListDirectory.mockResolvedValueOnce(listing([{ name: 'bulut-bahcivani.png', size: 8 }]));
        sessionReadFile.mockResolvedValueOnce({ success: false, error: 'EACCES' });
        expect(await loadSessionImage('s1', imagePath)).toEqual({ ok: false, error: { kind: 'failed', message: 'EACCES' } });

        sessionListDirectory.mockRejectedValueOnce(new Error('socket closed'));
        expect(await loadSessionImage('s1', imagePath)).toEqual({ ok: false, error: { kind: 'failed', message: 'socket closed' } });
    });

    it('reuses the last read until the file changes', async () => {
        sessionListDirectory.mockResolvedValue(listing([{ name: 'bulut-bahcivani.png', size: 8, modified: 1 }]));
        sessionReadFile.mockResolvedValue({ success: true, content: PNG_BASE64 });

        await loadSessionImage('s1', imagePath);
        await loadSessionImage('s1', imagePath);
        expect(sessionListDirectory).toHaveBeenCalledTimes(2);
        expect(sessionReadFile).toHaveBeenCalledTimes(1);

        // Regenerated under the same name.
        sessionListDirectory.mockResolvedValue(listing([{ name: 'bulut-bahcivani.png', size: 8, modified: 2 }]));
        sessionReadFile.mockResolvedValue({ success: true, content: 'R0lGODlh' });
        expect(await loadSessionImage('s1', imagePath)).toEqual({ ok: true, uri: 'data:image/png;base64,R0lGODlh' });
        expect(sessionReadFile).toHaveBeenCalledTimes(2);
    });

    it('shares one read between concurrent callers', async () => {
        sessionListDirectory.mockResolvedValue(listing([{ name: 'bulut-bahcivani.png', size: 8 }]));
        sessionReadFile.mockResolvedValue({ success: true, content: PNG_BASE64 });

        const [a, b] = await Promise.all([loadSessionImage('s1', imagePath), loadSessionImage('s1', imagePath)]);

        expect(a).toEqual(b);
        expect(sessionListDirectory).toHaveBeenCalledTimes(1);
        expect(sessionReadFile).toHaveBeenCalledTimes(1);
    });
});
