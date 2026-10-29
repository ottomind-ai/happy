/**
 * Exposes an image file on the session's machine as a data URI (see
 * utils/sessionImage). Starts from the last copy read, so scrolling back
 * through the chat paints at once, then re-checks the file over the session
 * RPC and swaps in a fresh read only when its size or mtime changed. If that
 * check fails, the copy already read stays up. `retry` re-runs the load.
 */
import * as React from 'react';
import { loadSessionImage, peekSessionImage, SessionImageError } from '@/utils/sessionImage';

export type SessionImageState = {
    uri: string | null;
    loading: boolean;
    error: SessionImageError | null;
};

export function useSessionImage(sessionId: string, path: string | null): SessionImageState & { retry: () => void } {
    const [attempt, setAttempt] = React.useState(0);
    const [state, setState] = React.useState<SessionImageState>(() => {
        const cached = path ? peekSessionImage(sessionId, path) : null;
        return { uri: cached, loading: !!path && !cached, error: null };
    });

    React.useEffect(() => {
        if (!path) {
            setState({ uri: null, loading: false, error: null });
            return;
        }
        let cancelled = false;
        const cached = peekSessionImage(sessionId, path);
        setState({ uri: cached, loading: !cached, error: null });

        loadSessionImage(sessionId, path).then((result) => {
            if (cancelled) return;
            if (result.ok) {
                setState({ uri: result.uri, loading: false, error: null });
            } else if (cached) {
                // Machine offline or file gone: keep showing the copy already read.
                setState({ uri: cached, loading: false, error: null });
            } else {
                setState({ uri: null, loading: false, error: result.error });
            }
        });

        return () => { cancelled = true; };
    }, [sessionId, path, attempt]);

    const retry = React.useCallback(() => setAttempt((n) => n + 1), []);
    return { ...state, retry };
}
