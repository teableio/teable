import { generateAttachmentId, type IAttachmentItem } from '@teable/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCellKey,
  type ICellUploadTask,
  useCellAttachmentUploadStore,
} from '../../../../../store/use-attachment-upload-store';
import { usePendingAttachmentUpload } from './usePendingAttachmentUpload';

const tableId = 'tbl_test';
const tempRecordId = 'rec_temp';
const fieldId = 'fld_attachment';
const baseId = 'base_test';
const cellKey = buildCellKey(tableId, tempRecordId, fieldId);

const createAttachmentItem = (name: string): IAttachmentItem => {
  const id = generateAttachmentId();
  return {
    id,
    name,
    path: `/tmp/${name}`,
    token: `token_${id}`,
    size: 1024,
    mimetype: 'text/plain',
  };
};

const createCompletedTask = (item: IAttachmentItem): ICellUploadTask => ({
  id: item.id,
  file: new File(['x'], item.name, { type: item.mimetype }),
  progress: 100,
  status: 'completed',
  attachmentItem: item,
});

const setCellTasks = (tasks: ICellUploadTask[]) => {
  useCellAttachmentUploadStore.setState((prev) => ({
    ...prev,
    cellUploads: {
      ...prev.cellUploads,
      [cellKey]: {
        tableId,
        recordId: tempRecordId,
        fieldId,
        baseId,
        tasks,
        manager: { cancelTask: vi.fn() } as never,
        isPending: true,
      },
    },
  }));
};

describe('usePendingAttachmentUpload', () => {
  beforeEach(() => {
    useCellAttachmentUploadStore.setState({ cellUploads: {} });
  });

  afterEach(() => {
    useCellAttachmentUploadStore.setState({ cellUploads: {} });
    vi.clearAllMocks();
  });

  it('merges rapid completed uploads without losing previous items when parent attachments are stale', async () => {
    const first = createAttachmentItem('first.txt');
    const second = createAttachmentItem('second.txt');
    const onChange = vi.fn();

    renderHook(
      (props: { attachments: IAttachmentItem[] }) =>
        usePendingAttachmentUpload({
          tableId,
          tempRecordId,
          fieldId,
          baseId,
          attachments: props.attachments,
          onChange,
        }),
      {
        initialProps: { attachments: [] as IAttachmentItem[] },
      }
    );

    act(() => {
      setCellTasks([createCompletedTask(first)]);
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    expect(onChange.mock.calls[0][0].map((item: IAttachmentItem) => item.id)).toEqual([first.id]);

    // Parent attachments prop is still stale here ([]), second upload completes.
    act(() => {
      setCellTasks([createCompletedTask(second)]);
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    expect(onChange.mock.calls[1][0].map((item: IAttachmentItem) => item.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('does not duplicate items after parent attachments catches up', async () => {
    const first = createAttachmentItem('first.txt');
    const second = createAttachmentItem('second.txt');
    const onChange = vi.fn();

    const { rerender } = renderHook(
      (props: { attachments: IAttachmentItem[] }) =>
        usePendingAttachmentUpload({
          tableId,
          tempRecordId,
          fieldId,
          baseId,
          attachments: props.attachments,
          onChange,
        }),
      {
        initialProps: { attachments: [] as IAttachmentItem[] },
      }
    );

    act(() => {
      setCellTasks([createCompletedTask(first)]);
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    // Simulate parent value sync from the previous onChange.
    rerender({ attachments: [first] });

    act(() => {
      setCellTasks([createCompletedTask(second)]);
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    expect(onChange.mock.calls[1][0].map((item: IAttachmentItem) => item.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('keeps completed task in store when attachment is already in parent value', async () => {
    const first = createAttachmentItem('first.txt');
    const onChange = vi.fn();

    renderHook(() =>
      usePendingAttachmentUpload({
        tableId,
        tempRecordId,
        fieldId,
        baseId,
        attachments: [first],
        onChange,
      })
    );

    act(() => {
      setCellTasks([createCompletedTask(first)]);
    });

    await waitFor(() => {
      const tasks = useCellAttachmentUploadStore.getState().cellUploads[cellKey]?.tasks ?? [];
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('completed');
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps late-completed task consumable during createRecords flight', async () => {
    const late = createAttachmentItem('late.txt');
    const onChange = vi.fn();
    const store = useCellAttachmentUploadStore.getState();

    renderHook(() =>
      usePendingAttachmentUpload({
        tableId,
        tempRecordId,
        fieldId,
        baseId,
        attachments: [],
        onChange,
      })
    );

    // Simulate createRecords starts before this upload completes.
    const beforeComplete = store.consumePendingForCreate(tableId, tempRecordId);
    expect(beforeComplete.completedByField).toEqual({});

    // Upload completes while createRecords is in flight.
    act(() => {
      setCellTasks([createCompletedTask(late)]);
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    // Task must remain in store so create flow can consume/promote it.
    const afterComplete = store.consumePendingForCreate(tableId, tempRecordId);
    expect(afterComplete.completedByField[fieldId]).toBeDefined();
    expect(afterComplete.completedByField[fieldId][0].id).toBe(late.id);
  });
});
