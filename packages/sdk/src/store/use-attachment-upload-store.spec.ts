/* eslint-disable sonarjs/no-duplicate-string */
import type { INotifyVo, UploadType } from '@teable/openapi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCellKey, useCellAttachmentUploadStore } from './use-attachment-upload-store';

interface IFileLike {
  id: string;
  instance: File;
}

interface IUploadCallbacks {
  successCallback?: (file: IFileLike, attachment: INotifyVo) => void;
  errorCallback?: (file: IFileLike, error?: string, code?: number) => void;
  progressCallback?: (file: IFileLike, progress: number) => void;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const { MockAttachmentManager } = vi.hoisted(() => {
  class HoistedMockAttachmentManager {
    limit: number;
    private callbacksByFileId = new Map<string, { file: IFileLike; callbacks: IUploadCallbacks }>();

    constructor(limit: number) {
      this.limit = limit;
    }

    upload(files: IFileLike[], _type: UploadType, callbacks: IUploadCallbacks, _baseId?: string) {
      files.forEach((file) => {
        this.callbacksByFileId.set(file.id, { file, callbacks });
      });
    }

    cancelTask = vi.fn();

    triggerSuccess(fileId: string, attachment: INotifyVo) {
      const entry = this.callbacksByFileId.get(fileId);
      entry?.callbacks.successCallback?.(entry.file, attachment);
    }
  }

  return { MockAttachmentManager: HoistedMockAttachmentManager };
});

// eslint-disable-next-line @typescript-eslint/naming-convention
type HoistedMockAttachmentManager = InstanceType<typeof MockAttachmentManager>;

// eslint-disable-next-line @typescript-eslint/naming-convention
const { mockInsertAttachment } = vi.hoisted(() => {
  return {
    mockInsertAttachment: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@teable/openapi', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    insertAttachment: mockInsertAttachment,
  };
});

vi.mock('../components/editor/attachment/upload-attachment/uploadManage', () => {
  return {
    AttachmentManager: MockAttachmentManager,
  };
});

const createNotifyVo = (token: string): INotifyVo => ({
  token,
  size: 1024,
  url: `/files/${token}`,
  path: `/attachments/${token}`,
  mimetype: 'text/plain',
  presignedUrl: `/preview/${token}`,
});

const createPersistedAttachment = (token: string) => ({
  id: `att_${token}`,
  name: `${token}.pdf`,
  token,
  size: 1024,
  path: `/attachments/${token}`,
  mimetype: 'application/pdf',
  presignedUrl: `/preview/${token}`,
  lgThumbnailUrl: `/preview/${token}_lg`,
  smThumbnailUrl: `/preview/${token}_sm`,
});

const createFile = (name: string) => new File(['content'], name, { type: 'text/plain' });

const setTaskStatus = (
  cellKey: string,
  status: 'pending' | 'uploading' | 'completed' | 'error'
) => {
  useCellAttachmentUploadStore.setState((prev) => {
    const state = prev.cellUploads[cellKey];
    if (!state || state.tasks.length === 0) return prev;
    return {
      cellUploads: {
        ...prev.cellUploads,
        [cellKey]: {
          ...state,
          tasks: state.tasks.map((task) => ({ ...task, status })),
        },
      },
    };
  });
};

describe('useCellAttachmentUploadStore promoted key cleanup', () => {
  const tableId = 'tbl_test';
  const fieldId = 'fld_test';
  const tempRecordId = 'rec_temp';
  const realRecordId = 'rec_real';

  beforeEach(() => {
    useCellAttachmentUploadStore.setState({ cellUploads: {} });
  });

  afterEach(() => {
    useCellAttachmentUploadStore.setState({ cellUploads: {} });
    mockInsertAttachment.mockClear();
    vi.clearAllMocks();
  });

  it('cleans promoted mapping when real cell is removed by removeTask', () => {
    const oldKey = buildCellKey(tableId, tempRecordId, fieldId);
    const newKey = buildCellKey(tableId, realRecordId, fieldId);
    const store = useCellAttachmentUploadStore.getState();

    store.startPendingUpload(tableId, tempRecordId, fieldId, [createFile('first.txt')], 'base');
    const firstTaskId = useCellAttachmentUploadStore.getState().cellUploads[oldKey].tasks[0].id;

    store.promoteToCell(tableId, tempRecordId, realRecordId);
    store.removeTask(newKey, firstTaskId);

    store.startPendingUpload(tableId, tempRecordId, fieldId, [createFile('second.txt')], 'base');
    const stateAfterRestart = useCellAttachmentUploadStore.getState().cellUploads[oldKey];
    const secondTaskId = stateAfterRestart.tasks[0].id;
    const manager = stateAfterRestart.manager as unknown as HoistedMockAttachmentManager;
    manager.triggerSuccess(secondTaskId, createNotifyVo('token_second'));

    const updatedTask = useCellAttachmentUploadStore.getState().cellUploads[oldKey].tasks[0];
    expect(updatedTask.status).toBe('completed');
    expect(updatedTask.attachmentItem?.token).toBe('token_second');
  });

  it('cleans promoted mapping when real cell is removed by clearCompletedTasks', () => {
    const oldKey = buildCellKey(tableId, tempRecordId, fieldId);
    const newKey = buildCellKey(tableId, realRecordId, fieldId);
    const store = useCellAttachmentUploadStore.getState();

    store.startPendingUpload(tableId, tempRecordId, fieldId, [createFile('first.txt')], 'base');
    store.promoteToCell(tableId, tempRecordId, realRecordId);
    setTaskStatus(newKey, 'completed');
    store.clearCompletedTasks();

    store.startPendingUpload(tableId, tempRecordId, fieldId, [createFile('second.txt')], 'base');
    const stateAfterRestart = useCellAttachmentUploadStore.getState().cellUploads[oldKey];
    const secondTaskId = stateAfterRestart.tasks[0].id;
    const manager = stateAfterRestart.manager as unknown as HoistedMockAttachmentManager;
    manager.triggerSuccess(secondTaskId, createNotifyVo('token_second'));

    const updatedTask = useCellAttachmentUploadStore.getState().cellUploads[oldKey].tasks[0];
    expect(updatedTask.status).toBe('completed');
    expect(updatedTask.attachmentItem?.token).toBe('token_second');
  });

  it('cleans promoted mapping when real cell is removed by clearErrorTasks', () => {
    const oldKey = buildCellKey(tableId, tempRecordId, fieldId);
    const newKey = buildCellKey(tableId, realRecordId, fieldId);
    const store = useCellAttachmentUploadStore.getState();

    store.startPendingUpload(tableId, tempRecordId, fieldId, [createFile('first.txt')], 'base');
    store.promoteToCell(tableId, tempRecordId, realRecordId);
    setTaskStatus(newKey, 'error');
    store.clearErrorTasks();

    store.startPendingUpload(tableId, tempRecordId, fieldId, [createFile('second.txt')], 'base');
    const stateAfterRestart = useCellAttachmentUploadStore.getState().cellUploads[oldKey];
    const secondTaskId = stateAfterRestart.tasks[0].id;
    const manager = stateAfterRestart.manager as unknown as HoistedMockAttachmentManager;
    manager.triggerSuccess(secondTaskId, createNotifyVo('token_second'));

    const updatedTask = useCellAttachmentUploadStore.getState().cellUploads[oldKey].tasks[0];
    expect(updatedTask.status).toBe('completed');
    expect(updatedTask.attachmentItem?.token).toBe('token_second');
  });

  it('retries pending tasks in pending mode', () => {
    const pendingKey = buildCellKey(tableId, tempRecordId, fieldId);
    const store = useCellAttachmentUploadStore.getState();

    store.startPendingUpload(tableId, tempRecordId, fieldId, [createFile('pending.txt')], 'base');
    const firstTask = useCellAttachmentUploadStore.getState().cellUploads[pendingKey].tasks[0];

    store.retryTask(pendingKey, firstTask.id);

    const retriedState = useCellAttachmentUploadStore.getState().cellUploads[pendingKey];
    expect(retriedState).toBeDefined();
    expect(retriedState.isPending).toBe(true);
    expect(retriedState.tasks).toHaveLength(1);
    expect(retriedState.tasks[0].id).not.toBe(firstTask.id);
  });

  it('retries normal tasks in normal mode', () => {
    const recordId = 'rec_normal';
    const normalKey = buildCellKey(tableId, recordId, fieldId);
    const store = useCellAttachmentUploadStore.getState();

    store.startUpload(tableId, recordId, fieldId, [createFile('normal.txt')], 'base');
    const firstTask = useCellAttachmentUploadStore.getState().cellUploads[normalKey].tasks[0];

    store.retryTask(normalKey, firstTask.id);

    const retriedState = useCellAttachmentUploadStore.getState().cellUploads[normalKey];
    expect(retriedState).toBeDefined();
    expect(retriedState.isPending).toBeFalsy();
    expect(retriedState.tasks).toHaveLength(1);
    expect(retriedState.tasks[0].id).not.toBe(firstTask.id);
  });

  it('returns completed pending attachments by field and ignores non-pending cells', () => {
    const otherFieldId = 'fld_other';
    const pendingKey = buildCellKey(tableId, tempRecordId, fieldId);
    const otherPendingKey = buildCellKey(tableId, tempRecordId, otherFieldId);
    const normalKey = buildCellKey(tableId, realRecordId, fieldId);
    const store = useCellAttachmentUploadStore.getState();

    store.startPendingUpload(tableId, tempRecordId, fieldId, [createFile('pending-a.txt')], 'base');
    store.startPendingUpload(
      tableId,
      tempRecordId,
      otherFieldId,
      [createFile('pending-b.txt')],
      'base'
    );
    store.startUpload(tableId, realRecordId, fieldId, [createFile('normal.txt')], 'base');

    const pendingTaskId =
      useCellAttachmentUploadStore.getState().cellUploads[pendingKey].tasks[0].id;
    const otherPendingTaskId =
      useCellAttachmentUploadStore.getState().cellUploads[otherPendingKey].tasks[0].id;
    const normalTaskId = useCellAttachmentUploadStore.getState().cellUploads[normalKey].tasks[0].id;

    const pendingManager = useCellAttachmentUploadStore.getState().cellUploads[pendingKey]
      .manager as unknown as HoistedMockAttachmentManager;
    const otherPendingManager = useCellAttachmentUploadStore.getState().cellUploads[otherPendingKey]
      .manager as unknown as HoistedMockAttachmentManager;
    const normalManager = useCellAttachmentUploadStore.getState().cellUploads[normalKey]
      .manager as unknown as HoistedMockAttachmentManager;

    pendingManager.triggerSuccess(pendingTaskId, createNotifyVo('token_a'));
    otherPendingManager.triggerSuccess(otherPendingTaskId, createNotifyVo('token_b'));
    normalManager.triggerSuccess(normalTaskId, createNotifyVo('token_normal'));

    const completed = store.getCompletedPendingAttachments(tableId, tempRecordId);
    expect(Object.keys(completed).sort()).toEqual([fieldId, otherFieldId].sort());
    expect(completed[fieldId][0].token).toBe('token_a');
    expect(completed[otherFieldId][0].token).toBe('token_b');
  });

  it('updates hasPendingUploads and clears pending tasks on cancel', () => {
    const pendingKey = buildCellKey(tableId, tempRecordId, fieldId);
    const store = useCellAttachmentUploadStore.getState();

    store.startPendingUpload(tableId, tempRecordId, fieldId, [createFile('pending.txt')], 'base');
    expect(store.hasPendingUploads(tableId, tempRecordId)).toBe(true);

    const pendingTaskId =
      useCellAttachmentUploadStore.getState().cellUploads[pendingKey].tasks[0].id;
    const pendingManager = useCellAttachmentUploadStore.getState().cellUploads[pendingKey]
      .manager as unknown as HoistedMockAttachmentManager;
    pendingManager.triggerSuccess(pendingTaskId, createNotifyVo('token_done'));

    expect(store.hasPendingUploads(tableId, tempRecordId)).toBe(false);
    expect(useCellAttachmentUploadStore.getState().cellUploads[pendingKey]).toBeDefined();

    store.cancelPendingUploads(tableId, tempRecordId);
    expect(useCellAttachmentUploadStore.getState().cellUploads[pendingKey]).toBeUndefined();
  });

  it('promotes late completed pending tasks and inserts them into real record', async () => {
    vi.useFakeTimers();
    try {
      const pendingKey = buildCellKey(tableId, tempRecordId, fieldId);
      const realKey = buildCellKey(tableId, realRecordId, fieldId);
      const store = useCellAttachmentUploadStore.getState();

      store.startPendingUpload(tableId, tempRecordId, fieldId, [createFile('late.txt')], 'base');
      const pendingTaskId =
        useCellAttachmentUploadStore.getState().cellUploads[pendingKey].tasks[0].id;
      const pendingManager = useCellAttachmentUploadStore.getState().cellUploads[pendingKey]
        .manager as unknown as HoistedMockAttachmentManager;

      const consumed = store.consumePendingForCreate(tableId, tempRecordId);
      expect(consumed.completedByField[fieldId]).toBeUndefined();

      // Simulate createRecords flight: completion occurs after consume, before promote.
      pendingManager.triggerSuccess(pendingTaskId, createNotifyVo('token_late'));
      store.promoteToCell(tableId, tempRecordId, realRecordId, consumed.consumedTaskIdsByCellKey);
      expect(useCellAttachmentUploadStore.getState().cellUploads[realKey]).toBeDefined();

      await vi.runAllTimersAsync();
      expect(mockInsertAttachment).toHaveBeenCalledWith(
        tableId,
        realRecordId,
        fieldId,
        expect.arrayContaining([expect.objectContaining({ token: 'token_late' })])
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('syncs latest persisted attachment thumbnails back into completed tasks', async () => {
    vi.useFakeTimers();
    try {
      const recordId = 'rec_sync';
      const cellKey = buildCellKey(tableId, recordId, fieldId);
      const store = useCellAttachmentUploadStore.getState();

      store.startUpload(tableId, recordId, fieldId, [createFile('token_sync.pdf')], 'base');
      const taskId = useCellAttachmentUploadStore.getState().cellUploads[cellKey].tasks[0].id;
      const manager = useCellAttachmentUploadStore.getState().cellUploads[cellKey]
        .manager as unknown as HoistedMockAttachmentManager;

      manager.triggerSuccess(taskId, {
        ...createNotifyVo('token_sync'),
        mimetype: 'application/pdf',
      });

      expect(
        useCellAttachmentUploadStore.getState().cellUploads[cellKey].tasks[0].attachmentItem?.token
      ).toBe('token_sync');

      await vi.runAllTimersAsync();

      store.syncCellAttachments(cellKey, [createPersistedAttachment('token_sync')]);

      const updatedTask = useCellAttachmentUploadStore.getState().cellUploads[cellKey].tasks[0];
      expect(updatedTask.attachmentItem?.id).toBe('att_token_sync');
      expect(updatedTask.attachmentItem?.lgThumbnailUrl).toBe('/preview/token_sync_lg');
      expect(updatedTask.attachmentItem?.smThumbnailUrl).toBe('/preview/token_sync_sm');
    } finally {
      vi.useRealTimers();
    }
  });
});
