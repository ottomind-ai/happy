import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sessionListDirectory, sessionReadFile } = vi.hoisted(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    return { sessionListDirectory: vi.fn(), sessionReadFile: vi.fn() };
});
vi.mock('@/sync/ops', () => ({ sessionListDirectory, sessionReadFile }));

import { resetSessionImageCache } from '@/utils/sessionImage';
import { useSessionImage } from './useSessionImage';

const path = '/Users/ctx/temp/output/imagegen/x.png';
const listed = { success: true, entries: [{ name: 'x.png', type: 'file', size: 8, modified: 1 }] };

let current: ReturnType<typeof useSessionImage>;
function Harness(props: { path: string | null }) {
    current = useSessionImage('s1', props.path);
    return null;
}

let renderer: ReturnType<typeof create> | undefined;
async function render(imagePath: string | null) {
    await act(async () => { renderer = create(React.createElement(Harness, { path: imagePath })); });
}

describe('useSessionImage', () => {
    beforeEach(() => {
        resetSessionImageCache();
        sessionListDirectory.mockReset();
        sessionReadFile.mockReset();
    });
    afterEach(async () => {
        await act(async () => { renderer?.unmount(); });
        renderer = undefined;
    });

    it('does nothing without a path', async () => {
        await render(null);
        expect(current).toMatchObject({ uri: null, loading: false, error: null });
        expect(sessionListDirectory).not.toHaveBeenCalled();
    });

    it('loads the image as a data URI', async () => {
        sessionListDirectory.mockResolvedValue(listed);
        sessionReadFile.mockResolvedValue({ success: true, content: 'iVBORw0KGgo=' });

        await render(path);

        expect(current).toMatchObject({ uri: 'data:image/png;base64,iVBORw0KGgo=', loading: false, error: null });
    });

    it('reports errors and retries on request', async () => {
        sessionListDirectory.mockResolvedValueOnce({ success: false, error: 'RPC method not available' });
        await render(path);
        expect(current).toMatchObject({ uri: null, loading: false, error: { kind: 'failed', message: 'RPC method not available' } });

        sessionListDirectory.mockResolvedValueOnce(listed);
        sessionReadFile.mockResolvedValueOnce({ success: true, content: 'iVBORw0KGgo=' });
        await act(async () => { current.retry(); });
        expect(current).toMatchObject({ uri: 'data:image/png;base64,iVBORw0KGgo=', error: null });
    });

    it('paints the last read at once and keeps it when the re-check fails', async () => {
        sessionListDirectory.mockResolvedValue(listed);
        sessionReadFile.mockResolvedValue({ success: true, content: 'iVBORw0KGgo=' });
        await render(path);
        await act(async () => { renderer?.unmount(); });

        sessionListDirectory.mockResolvedValue({ success: false, error: 'machine offline' });
        let firstUri: string | null = null;
        await act(async () => {
            renderer = create(React.createElement(Harness, { path }));
            firstUri = current.uri;
        });

        expect(firstUri).toBe('data:image/png;base64,iVBORw0KGgo=');
        expect(current).toMatchObject({ uri: 'data:image/png;base64,iVBORw0KGgo=', loading: false, error: null });
    });
});
