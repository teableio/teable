import { LocalStorageKeys } from '@teable/sdk/config';
import type * as SdkHooks from '@teable/sdk/hooks';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useResourceDescriptionAutoOpen } from './useResourceDescriptionAutoOpen';

const sdkHookMocks = vi.hoisted(() => ({
  useIsTemplate: vi.fn(),
}));

vi.mock('@teable/sdk/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof SdkHooks>();
  return {
    ...actual,
    useIsTemplate: sdkHookMocks.useIsTemplate,
  };
});

const resourceId = 'tblTestTable';

const getSeenStorageKey = (id: string) => {
  return `${LocalStorageKeys.BaseNodeDescriptionSeen}:${id}`;
};

const readSeenFingerprint = (id = resourceId) => {
  return window.localStorage.getItem(getSeenStorageKey(id));
};

const renderDescriptionHook = (description: string | null = 'Initial description') => {
  return renderHook(
    (props: { resourceId?: string; description?: string | null }) =>
      useResourceDescriptionAutoOpen(props),
    {
      initialProps: { resourceId, description },
    }
  );
};

describe('useResourceDescriptionAutoOpen', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    sdkHookMocks.useIsTemplate.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('auto opens once and persists the description fingerprint before the next entry', async () => {
    const firstEntry = renderDescriptionHook();

    await waitFor(() => expect(firstEntry.result.current.autoOpenKey).toContain(resourceId));
    expect(readSeenFingerprint()).toBeTruthy();
    firstEntry.unmount();

    const nextEntry = renderDescriptionHook();

    await waitFor(() => expect(nextEntry.result.current.autoOpenKey).toBeUndefined());
  });

  it('tracks different resources independently', async () => {
    const workflowId = 'wflTestWorkflow';
    const { result, rerender } = renderDescriptionHook();

    await waitFor(() => expect(result.current.autoOpenKey).toContain(resourceId));

    rerender({ resourceId: workflowId, description: 'Workflow description' });

    await waitFor(() => expect(result.current.autoOpenKey).toContain(workflowId));
    expect(readSeenFingerprint()).toBeTruthy();
    expect(readSeenFingerprint(workflowId)).toBeTruthy();
  });

  it('waits until the next resource entry before opening an updated description', async () => {
    const { result, rerender } = renderDescriptionHook();

    await waitFor(() => expect(result.current.autoOpenKey).toContain(resourceId));
    const initialAutoOpenKey = result.current.autoOpenKey;
    const initialFingerprint = readSeenFingerprint();

    rerender({ resourceId, description: 'Updated description' });

    expect(result.current.autoOpenKey).toBe(initialAutoOpenKey);
    expect(readSeenFingerprint()).toBe(initialFingerprint);

    rerender({ resourceId: 'tblOtherTable', description: null });
    rerender({ resourceId, description: 'Updated description' });

    await waitFor(() => expect(result.current.autoOpenKey).not.toBe(initialAutoOpenKey));
    expect(readSeenFingerprint()).not.toBe(initialFingerprint);
  });

  it('clears stale seen state for an empty description without opening during the same entry', async () => {
    const otherResourceId = 'tblOtherTable';
    window.localStorage.setItem(getSeenStorageKey(resourceId), 'stale-fingerprint');
    window.localStorage.setItem(getSeenStorageKey(otherResourceId), 'other-fingerprint');
    const { result, rerender } = renderDescriptionHook(null);

    await waitFor(() => expect(readSeenFingerprint()).toBeNull());
    expect(result.current.autoOpenKey).toBeUndefined();
    expect(readSeenFingerprint(otherResourceId)).toBe('other-fingerprint');

    rerender({ resourceId, description: 'Added during this entry' });

    expect(result.current.autoOpenKey).toBeUndefined();
    expect(readSeenFingerprint()).toBeNull();

    rerender({ resourceId: otherResourceId, description: null });
    rerender({ resourceId, description: 'Added during this entry' });

    await waitFor(() => expect(result.current.autoOpenKey).toContain(resourceId));
    expect(readSeenFingerprint()).toBeTruthy();
  });

  it('marks an editor-saved description and removes the mark after a successful clear', () => {
    const { result } = renderDescriptionHook(null);

    act(() => result.current.markDescriptionSeen('Saved description'));
    expect(readSeenFingerprint()).toBeTruthy();

    act(() => result.current.markDescriptionSeen(null));
    expect(readSeenFingerprint()).toBeNull();
  });

  it('does not auto open or touch local storage in template preview', () => {
    sdkHookMocks.useIsTemplate.mockReturnValue(true);

    const { result } = renderDescriptionHook();

    expect(result.current.autoOpenKey).toBeUndefined();
    expect(readSeenFingerprint()).toBeNull();
  });

  it('fails open when local storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    const { result } = renderDescriptionHook();

    await waitFor(() => expect(result.current.autoOpenKey).toContain(resourceId));
  });

  it('replaces an invalid fingerprint with the current seen state', async () => {
    window.localStorage.setItem(getSeenStorageKey(resourceId), 'invalid-fingerprint');

    const { result } = renderDescriptionHook();

    await waitFor(() => expect(result.current.autoOpenKey).toContain(resourceId));
    expect(readSeenFingerprint()).not.toBe('invalid-fingerprint');
  });
});
