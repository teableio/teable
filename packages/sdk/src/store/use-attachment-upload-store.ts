import type { IAttachmentItem } from '@teable/core';
import { generateAttachmentId, HttpError } from '@teable/core';
import { insertAttachment, UploadType } from '@teable/openapi';
import { omit } from 'lodash';
import { create } from 'zustand';
import {
  AttachmentManager,
  type IFile,
} from '../components/editor/attachment/upload-attachment/uploadManage';

export interface ICellUploadTask {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
  code?: number;
}

interface ICellUploadState {
  tableId: string;
  recordId: string;
  fieldId: string;
  baseId?: string;
  tasks: ICellUploadTask[];
  manager: AttachmentManager;
}

export interface IGlobalUploadTask extends ICellUploadTask {
  cellKey: string;
  fileName: string;
}

export interface IGlobalUploadProgress {
  total: number;
  completed: number;
  uploading: number;
  failed: number;
  progress: number;
}

interface ICellAttachmentUploadState {
  // Map of cellKey -> upload state
  cellUploads: Record<string, ICellUploadState>;

  // Start upload for a cell
  startUpload: (
    tableId: string,
    recordId: string,
    fieldId: string,
    files: File[],
    baseId?: string
  ) => void;

  // Get tasks for a specific cell
  getCellTasks: (cellKey: string) => ICellUploadTask[];

  // Check if a cell has uploading tasks
  hasUploadingTasks: (cellKey: string) => boolean;

  // Global selectors
  getAllActiveTasks: () => IGlobalUploadTask[];
  getGlobalProgress: () => IGlobalUploadProgress;
  hasActiveUploads: () => boolean;
  clearCompletedTasks: () => void;
  clearErrorTasks: () => void;
  cancelTask: (cellKey: string, taskId: string) => void;
  removeTask: (cellKey: string, taskId: string) => void;
  retryTask: (cellKey: string, taskId: string) => void;
}

export const buildCellKey = (tableId: string, recordId: string, fieldId: string) =>
  `${tableId}:${recordId}:${fieldId}`;

// Update task in store
const updateTask = (cellKey: string, taskId: string, update: Partial<ICellUploadTask>) => {
  useCellAttachmentUploadStore.setState((prev) => {
    const cellState = prev.cellUploads[cellKey];
    if (!cellState) return prev;

    return {
      cellUploads: {
        ...prev.cellUploads,
        [cellKey]: {
          ...cellState,
          tasks: cellState.tasks.map((t) => (t.id === taskId ? { ...t, ...update } : t)),
        },
      },
    };
  });
};

// Remove task from store
const removeTask = (cellKey: string, taskId: string) => {
  useCellAttachmentUploadStore.setState((prev) => {
    const cellState = prev.cellUploads[cellKey];
    if (!cellState) return prev;

    const newTasks = cellState.tasks.filter((t) => t.id !== taskId);

    // Clean up if no more tasks
    if (newTasks.length === 0) {
      const { [cellKey]: _, ...rest } = prev.cellUploads;
      return { cellUploads: rest };
    }

    return {
      cellUploads: {
        ...prev.cellUploads,
        [cellKey]: {
          ...cellState,
          tasks: newTasks,
        },
      },
    };
  });
};

// eslint-disable-next-line @typescript-eslint/naming-convention
const INSERT_DEBOUNCE_MS = 300;

interface IInsertBuffer {
  tableId: string;
  recordId: string;
  fieldId: string;
  pending: Array<{ taskId: string; attachment: IAttachmentItem }>;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
}

const insertBuffers = new Map<string, IInsertBuffer>();

const getInsertBuffer = (cellKey: string, tableId: string, recordId: string, fieldId: string) => {
  const existing = insertBuffers.get(cellKey);
  if (existing) {
    existing.tableId = tableId;
    existing.recordId = recordId;
    existing.fieldId = fieldId;
    return existing;
  }
  const buffer: IInsertBuffer = {
    tableId,
    recordId,
    fieldId,
    pending: [],
    timer: null,
    inFlight: false,
  };
  insertBuffers.set(cellKey, buffer);
  return buffer;
};

const flushInsertBuffer = async (cellKey: string) => {
  const buffer = insertBuffers.get(cellKey);
  if (!buffer || buffer.inFlight || buffer.pending.length === 0) return;

  const pending = buffer.pending.slice();
  buffer.pending = [];
  buffer.inFlight = true;

  try {
    await insertAttachment(
      buffer.tableId,
      buffer.recordId,
      buffer.fieldId,
      pending.map((item) => item.attachment)
    );
    pending.forEach((item) => {
      updateTask(cellKey, item.taskId, { status: 'completed', progress: 100 });
    });
  } catch (error) {
    const code = error instanceof HttpError ? error.status : undefined;
    const errorMessage = error instanceof Error ? error.message : 'Failed to save';
    pending.forEach((item) => {
      updateTask(cellKey, item.taskId, { status: 'error', error: errorMessage, code });
    });
  } finally {
    buffer.inFlight = false;
    if (buffer.pending.length > 0) {
      if (buffer.timer) {
        clearTimeout(buffer.timer);
      }
      buffer.timer = setTimeout(() => {
        buffer.timer = null;
        void flushInsertBuffer(cellKey);
      }, INSERT_DEBOUNCE_MS);
    }
  }
};

const enqueueInsert = (
  cellKey: string,
  tableId: string,
  recordId: string,
  fieldId: string,
  taskId: string,
  attachment: IAttachmentItem
) => {
  const buffer = getInsertBuffer(cellKey, tableId, recordId, fieldId);
  buffer.pending.push({ taskId, attachment });
  if (buffer.timer) {
    clearTimeout(buffer.timer);
  }
  buffer.timer = setTimeout(() => {
    buffer.timer = null;
    void flushInsertBuffer(cellKey);
  }, INSERT_DEBOUNCE_MS);
};

const clearInsertBuffer = (cellKey: string) => {
  const buffer = insertBuffers.get(cellKey);
  if (buffer?.timer) {
    clearTimeout(buffer.timer);
  }
  insertBuffers.delete(cellKey);
};

// Get or create AttachmentManager for a cell
const getOrCreateManager = (cellKey: string): AttachmentManager => {
  const state = useCellAttachmentUploadStore.getState();
  const existing = state.cellUploads[cellKey]?.manager;
  if (existing) return existing;

  return new AttachmentManager(2);
};

export const useCellAttachmentUploadStore = create<ICellAttachmentUploadState>((set, get) => ({
  cellUploads: {},

  startUpload: (tableId, recordId, fieldId, files, baseId) => {
    if (files.length === 0) return;

    const cellKey = buildCellKey(tableId, recordId, fieldId);

    // Get or create manager for this cell
    const manager = getOrCreateManager(cellKey);

    // Create new tasks
    const uploadFiles: IFile[] = files.map((file) => ({
      id: generateAttachmentId(),
      instance: file,
    }));

    const newTasks: ICellUploadTask[] = uploadFiles.map(({ id, instance }) => ({
      id,
      file: instance,
      progress: 0,
      status: 'pending' as const,
    }));

    // Update state with new tasks and manager
    set((prev) => {
      const existing = prev.cellUploads[cellKey];
      return {
        cellUploads: {
          ...prev.cellUploads,
          [cellKey]: {
            tableId,
            recordId,
            fieldId,
            baseId,
            tasks: [...(existing?.tasks || []), ...newTasks],
            manager,
          },
        },
      };
    });

    // Start upload using AttachmentManager
    manager.upload(
      uploadFiles,
      UploadType.Table,
      {
        successCallback: (file, attachment) => {
          // Build attachment item
          const attachmentItem: IAttachmentItem = {
            id: file.id,
            name: file.instance.name,
            ...omit(attachment, ['url']),
          };

          enqueueInsert(cellKey, tableId, recordId, fieldId, file.id, attachmentItem);
        },
        errorCallback: (file, error, code) => {
          updateTask(cellKey, file.id, { status: 'error', error: error || 'Upload failed', code });
        },
        progressCallback: (file, progress) => {
          updateTask(cellKey, file.id, { progress, status: 'uploading' });
        },
      },
      baseId
    );
  },

  getCellTasks: (cellKey) => {
    return get().cellUploads[cellKey]?.tasks || [];
  },

  hasUploadingTasks: (cellKey) => {
    const tasks = get().cellUploads[cellKey]?.tasks || [];
    return tasks.some((t) => t.status === 'pending' || t.status === 'uploading');
  },

  getAllActiveTasks: () => {
    const { cellUploads } = get();
    const tasks: IGlobalUploadTask[] = [];
    Object.entries(cellUploads).forEach(([cellKey, cellState]) => {
      cellState.tasks.forEach((task) => {
        tasks.push({
          ...task,
          cellKey,
          fileName: task.file.name,
        });
      });
    });
    return tasks;
  },

  getGlobalProgress: () => {
    const { cellUploads } = get();
    let total = 0;
    let completed = 0;
    let uploading = 0;
    let failed = 0;
    let totalBytes = 0;
    let weightedProgressSum = 0;

    Object.values(cellUploads).forEach((cellState) => {
      cellState.tasks.forEach((task) => {
        // Weight progress by file size for accurate overall progress
        const fileSize = task.file.size || 1;
        total++;
        totalBytes += fileSize;
        if (task.status === 'completed') {
          completed++;
          weightedProgressSum += fileSize * 100;
        } else if (task.status === 'error') {
          failed++;
        } else {
          uploading++;
          weightedProgressSum += fileSize * task.progress;
        }
      });
    });
    return {
      total,
      completed,
      uploading,
      failed,
      progress: totalBytes > 0 ? Math.round(weightedProgressSum / totalBytes) : 0,
    };
  },

  hasActiveUploads: () => {
    const { cellUploads } = get();
    return Object.values(cellUploads).some((cellState) =>
      cellState.tasks.some((t) => t.status === 'pending' || t.status === 'uploading')
    );
  },

  clearCompletedTasks: () => {
    set((prev) => {
      const newCellUploads: Record<string, ICellUploadState> = {};
      Object.entries(prev.cellUploads).forEach(([cellKey, cellState]) => {
        const remainingTasks = cellState.tasks.filter((t) => t.status !== 'completed');
        if (remainingTasks.length > 0) {
          newCellUploads[cellKey] = { ...cellState, tasks: remainingTasks };
        } else {
          clearInsertBuffer(cellKey);
        }
      });
      return { cellUploads: newCellUploads };
    });
  },

  clearErrorTasks: () => {
    set((prev) => {
      const newCellUploads: Record<string, ICellUploadState> = {};
      Object.entries(prev.cellUploads).forEach(([cellKey, cellState]) => {
        const remainingTasks = cellState.tasks.filter((t) => t.status !== 'error');
        if (remainingTasks.length > 0) {
          newCellUploads[cellKey] = { ...cellState, tasks: remainingTasks };
        } else {
          clearInsertBuffer(cellKey);
        }
      });
      return { cellUploads: newCellUploads };
    });
  },
  cancelTask: (cellKey, taskId) => {
    const cellState = get().cellUploads[cellKey];
    if (!cellState) return;
    // Abort the HTTP request via AttachmentManager
    cellState.manager.cancelTask(taskId);
    // Remove the task from store state
    removeTask(cellKey, taskId);
  },
  removeTask: (cellKey, taskId) => {
    removeTask(cellKey, taskId);
  },
  retryTask: (cellKey, taskId) => {
    const cellState = get().cellUploads[cellKey];
    if (!cellState) return;
    const task = cellState.tasks.find((current) => current.id === taskId);
    if (!task) return;
    removeTask(cellKey, taskId);
    get().startUpload(
      cellState.tableId,
      cellState.recordId,
      cellState.fieldId,
      [task.file],
      cellState.baseId
    );
  },
}));
