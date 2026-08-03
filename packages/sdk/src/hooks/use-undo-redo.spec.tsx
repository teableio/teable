import type * as OpenApi from '@teable/openapi';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { createAppContext } from '../context/__tests__/createAppContext';
import { AnchorContext } from '../context/anchor/AnchorContext';
import { useUndoRedo } from './use-undo-redo';

const { mockRedoStream, mockToast, mockUndoStream } = vi.hoisted(() => {
  const toast = vi.fn(() => 'toast-id') as unknown as ReturnType<typeof vi.fn> & {
    (message: string, options?: object): string;
    loading: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
  };
  toast.loading = vi.fn(() => 'loading-toast-id');
  toast.success = vi.fn();
  toast.error = vi.fn();
  toast.dismiss = vi.fn();

  return {
    mockRedoStream: vi.fn(),
    mockToast: toast,
    mockUndoStream: vi.fn(),
  };
});

vi.mock('@teable/openapi', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenApi>();
  return {
    ...actual,
    redoStream: mockRedoStream,
    undoStream: mockUndoStream,
  };
});

vi.mock('@teable/ui-lib', () => ({
  sonner: {
    toast: mockToast,
  },
}));

const createWrapper = (tableId?: string) => {
  const appContextWrapper = createAppContext();

  return function wrapper({ children }: PropsWithChildren) {
    return appContextWrapper({
      children: <AnchorContext.Provider value={{ tableId }}>{children}</AnchorContext.Provider>,
    });
  };
};

describe('useUndoRedo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dismisses the loading toast before showing nothing-to-undo message', async () => {
    mockUndoStream.mockResolvedValue({ data: { status: 'empty' } });

    const { result } = renderHook(() => useUndoRedo(), { wrapper: createWrapper('tblTest') });

    await result.current.undo();

    expect(mockToast.loading).toHaveBeenCalledWith('Undoing...', { duration: Infinity });
    expect(mockToast.dismiss).toHaveBeenCalledWith('loading-toast-id');
    expect(mockToast).toHaveBeenCalledWith('Nothing to undo', { duration: 1500 });
    expect(mockToast.dismiss.mock.invocationCallOrder[0]).toBeLessThan(
      mockToast.mock.invocationCallOrder[0]
    );
  });

  it('dismisses the loading toast before showing nothing-to-redo message', async () => {
    mockRedoStream.mockResolvedValue({ data: { status: 'empty' } });

    const { result } = renderHook(() => useUndoRedo(), { wrapper: createWrapper('tblTest') });

    await result.current.redo();

    expect(mockToast.loading).toHaveBeenCalledWith('Redoing...', { duration: Infinity });
    expect(mockToast.dismiss).toHaveBeenCalledWith('loading-toast-id');
    expect(mockToast).toHaveBeenCalledWith('Nothing to redo', { duration: 1500 });
    expect(mockToast.dismiss.mock.invocationCallOrder[0]).toBeLessThan(
      mockToast.mock.invocationCallOrder[0]
    );
  });
});
