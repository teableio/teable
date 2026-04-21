import type { IAttachmentItem } from '@teable/core';
import { generateAttachmentId, HttpError } from '@teable/core';
import { insertAttachment, UploadType } from '@teable/openapi';
import { isEqual, omit } from 'lodash';
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
  /** Stored attachment data for pending uploads (not yet written to server) */
  attachmentItem?: IAttachmentItem;
}

interface ICellUploadState {
  tableId: string;
  recordId: string;
  fieldId: string;
  baseId?: string;
  tasks: ICellUploadTask[];
  manager: AttachmentManager;
  /** When true, completed uploads are held without calling insertAttachment */
  isPending?: boolean;
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

export interface IConsumedPendingForCreate {
  completedByField: Record<string, IAttachmentItem[]>;
  consumedTaskIdsByCellKey: Record<string, Set<string>>;
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

  // Start upload in pending mode (no auto insertAttachment on completion)
  startPendingUpload: (
    tableId: string,
    tempRecordId: string,
    fieldId: string,
    files: File[],
    baseId?: string
  ) => void;

  // Get completed attachments for a pending record (keyed by fieldId)
  getCompletedPendingAttachments: (
    tableId: string,
    tempRecordId: string
  ) => Record<string, IAttachmentItem[]>;

  // Atomically collect completed pending attachments before createRecords
  consumePendingForCreate: (tableId: string, tempRecordId: string) => IConsumedPendingForCreate;

  // Check if a pending record has any active uploads
  hasPendingUploads: (tableId: string, tempRecordId: string) => boolean;

  // Promote pending uploads to real cell uploads after record creation.
  // Completed tasks consumed by createRecords are dropped; others are remapped to real recordId.
  promoteToCell: (
    tableId: string,
    tempRecordId: string,
    realRecordId: string,
    consumedTaskIdsByCellKey?: Record<string, Set<string>>
  ) => void;

  // Cancel all uploads for a pending record (e.g. user cancels prefilling row)
  cancelPendingUploads: (tableId: string, tempRecordId: string) => void;

  // Get tasks for a specific cell
  getCellTasks: (cellKey: string) => ICellUploadTask[];

  // Sync latest persisted attachments back into upload tasks
  syncCellAttachments: (cellKey: string, attachments: IAttachmentItem[]) => void;

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

const matchAttachmentItem = (
  taskAttachment: IAttachmentItem | undefined,
  attachments: IAttachmentItem[]
) => {
  if (!taskAttachment) {
    return undefined;
  }

  return attachments.find((attachment) => {
    if (taskAttachment.token && attachment.token === taskAttachment.token) {
      return true;
    }
    if (taskAttachment.path && attachment.path === taskAttachment.path) {
      return true;
    }
    return attachment.name === taskAttachment.name && attachment.size === taskAttachment.size;
  });
};

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
      cleanupPromotedKeyMapByCellKey(cellKey);
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

// Map from old (temp) cellKey to new (real) cellKey after promotion
const promotedKeyMap = new Map<string, string>();

// Remove any promoted mapping related to this key (as oldKey or newKey)
const cleanupPromotedKeyMapByCellKey = (cellKey: string) => {
  for (const [oldKey, newKey] of promotedKeyMap.entries()) {
    if (oldKey === cellKey || newKey === cellKey) {
      promotedKeyMap.delete(oldKey);
    }
  }
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

          updateTask(cellKey, file.id, { attachmentItem });
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

  startPendingUpload: (tableId, tempRecordId, fieldId, files, baseId) => {
    if (files.length === 0) return;

    const cellKey = buildCellKey(tableId, tempRecordId, fieldId);
    const manager = getOrCreateManager(cellKey);

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

    set((prev) => {
      const existing = prev.cellUploads[cellKey];
      return {
        cellUploads: {
          ...prev.cellUploads,
          [cellKey]: {
            tableId,
            recordId: tempRecordId,
            fieldId,
            baseId,
            tasks: [...(existing?.tasks || []), ...newTasks],
            manager,
            isPending: true,
          },
        },
      };
    });

    manager.upload(
      uploadFiles,
      UploadType.Table,
      {
        successCallback: (file, attachment) => {
          const attachmentItem: IAttachmentItem = {
            id: file.id,
            name: file.instance.name,
            ...omit(attachment, ['url']),
          };

          // Check if this cell has been promoted to real cell mode
          const promotedKey = promotedKeyMap.get(cellKey);
          if (promotedKey) {
            // Already promoted — use normal insert flow with the real recordId
            const currentState = get().cellUploads[promotedKey];
            if (currentState) {
              enqueueInsert(
                promotedKey,
                currentState.tableId,
                currentState.recordId,
                currentState.fieldId,
                file.id,
                attachmentItem
              );
            }
          } else {
            // Still pending — store the attachment item without calling insertAttachment
            updateTask(cellKey, file.id, {
              status: 'completed',
              progress: 100,
              attachmentItem,
            });
          }
        },
        errorCallback: (file, error, code) => {
          // Use promoted key if available (tasks may have been remapped)
          const effectiveKey = promotedKeyMap.get(cellKey) ?? cellKey;
          updateTask(effectiveKey, file.id, {
            status: 'error',
            error: error || 'Upload failed',
            code,
          });
        },
        progressCallback: (file, progress) => {
          // Use promoted key if available (tasks may have been remapped)
          const effectiveKey = promotedKeyMap.get(cellKey) ?? cellKey;
          updateTask(effectiveKey, file.id, { progress, status: 'uploading' });
        },
      },
      baseId
    );
  },

  getCompletedPendingAttachments: (tableId, tempRecordId) => {
    const { cellUploads } = get();
    const result: Record<string, IAttachmentItem[]> = {};
    const prefix = `${tableId}:${tempRecordId}:`;

    Object.entries(cellUploads).forEach(([cellKey, cellState]) => {
      if (!cellKey.startsWith(prefix) || !cellState.isPending) return;

      const attachments: IAttachmentItem[] = [];
      cellState.tasks.forEach((task) => {
        if (task.status === 'completed' && task.attachmentItem) {
          attachments.push(task.attachmentItem);
        }
      });
      if (attachments.length > 0) {
        result[cellState.fieldId] = attachments;
      }
    });
    return result;
  },

  consumePendingForCreate: (tableId, tempRecordId) => {
    const { cellUploads } = get();
    const completedByField: Record<string, IAttachmentItem[]> = {};
    const consumedTaskIdsByCellKey: Record<string, Set<string>> = {};
    const prefix = `${tableId}:${tempRecordId}:`;

    Object.entries(cellUploads).forEach(([cellKey, cellState]) => {
      if (!cellKey.startsWith(prefix) || !cellState.isPending) return;

      cellState.tasks.forEach((task) => {
        if (task.status !== 'completed' || !task.attachmentItem) return;

        if (!completedByField[cellState.fieldId]) {
          completedByField[cellState.fieldId] = [];
        }
        completedByField[cellState.fieldId].push(task.attachmentItem);

        if (!consumedTaskIdsByCellKey[cellKey]) {
          consumedTaskIdsByCellKey[cellKey] = new Set<string>();
        }
        consumedTaskIdsByCellKey[cellKey].add(task.id);
      });
    });

    return { completedByField, consumedTaskIdsByCellKey };
  },

  hasPendingUploads: (tableId, tempRecordId) => {
    const { cellUploads } = get();
    const prefix = `${tableId}:${tempRecordId}:`;

    return Object.entries(cellUploads).some(([cellKey, cellState]) => {
      if (!cellKey.startsWith(prefix) || !cellState.isPending) return false;
      return cellState.tasks.some((t) => t.status === 'pending' || t.status === 'uploading');
    });
  },

  promoteToCell: (tableId, tempRecordId, realRecordId, consumedTaskIdsByCellKey = {}) => {
    set((prev) => {
      const newCellUploads = { ...prev.cellUploads };
      const prefix = `${tableId}:${tempRecordId}:`;

      Object.keys(newCellUploads).forEach((oldKey) => {
        if (!oldKey.startsWith(prefix)) return;
        const cellState = newCellUploads[oldKey];
        if (!cellState.isPending) return;
        const consumedTaskIds = consumedTaskIdsByCellKey[oldKey];
        const newKey = buildCellKey(tableId, realRecordId, cellState.fieldId);

        const remainingTasks = cellState.tasks.filter((task) => {
          // Completed tasks already consumed by createRecords can be safely removed.
          if (task.status === 'completed' && consumedTaskIds?.has(task.id)) {
            return false;
          }
          return true;
        });

        // Remove old key
        delete newCellUploads[oldKey];
        cleanupPromotedKeyMapByCellKey(oldKey);
        clearInsertBuffer(oldKey);

        // If there are still tasks, remap to real recordId.
        // This keeps errors retryable and allows late completed tasks to be inserted.
        if (remainingTasks.length > 0) {
          cleanupPromotedKeyMapByCellKey(newKey);
          newCellUploads[newKey] = {
            ...cellState,
            recordId: realRecordId,
            tasks: remainingTasks,
            isPending: false,
          };
          // Track mapping so in-flight callbacks can locate the real cell key.
          promotedKeyMap.set(oldKey, newKey);

          // Completed-but-not-consumed means they completed during createRecords flight.
          // They must be inserted into the newly created record.
          remainingTasks.forEach((task) => {
            if (task.status === 'completed' && task.attachmentItem) {
              enqueueInsert(
                newKey,
                tableId,
                realRecordId,
                cellState.fieldId,
                task.id,
                task.attachmentItem
              );
            }
          });
        }
      });

      return { cellUploads: newCellUploads };
    });
  },

  cancelPendingUploads: (tableId, tempRecordId) => {
    const { cellUploads } = get();
    const prefix = `${tableId}:${tempRecordId}:`;

    Object.entries(cellUploads).forEach(([cellKey, cellState]) => {
      if (!cellKey.startsWith(prefix) || !cellState.isPending) return;
      // Cancel all in-progress uploads
      cellState.tasks.forEach((task) => {
        if (task.status === 'pending' || task.status === 'uploading') {
          cellState.manager.cancelTask(task.id);
        }
      });
    });

    // Remove all pending cells from store and clean up promoted key map
    set((prev) => {
      const newCellUploads = { ...prev.cellUploads };
      Object.keys(newCellUploads).forEach((cellKey) => {
        if (cellKey.startsWith(prefix) && newCellUploads[cellKey].isPending) {
          clearInsertBuffer(cellKey);
          cleanupPromotedKeyMapByCellKey(cellKey);
          delete newCellUploads[cellKey];
        }
      });
      return { cellUploads: newCellUploads };
    });
  },

  getCellTasks: (cellKey) => {
    return get().cellUploads[cellKey]?.tasks || [];
  },

  syncCellAttachments: (cellKey, attachments) => {
    if (attachments.length === 0) return;

    set((prev) => {
      const cellState = prev.cellUploads[cellKey];
      if (!cellState) return prev;

      let hasChanges = false;
      const tasks = cellState.tasks.map((task) => {
        const matchedAttachment = matchAttachmentItem(task.attachmentItem, attachments);
        if (!matchedAttachment) {
          return task;
        }

        const nextAttachmentItem = {
          ...task.attachmentItem,
          ...matchedAttachment,
        };

        const unchanged = isEqual(task.attachmentItem, nextAttachmentItem);

        if (unchanged) {
          return task;
        }

        hasChanges = true;
        return {
          ...task,
          attachmentItem: nextAttachmentItem,
        };
      });

      if (!hasChanges) {
        return prev;
      }

      return {
        cellUploads: {
          ...prev.cellUploads,
          [cellKey]: {
            ...cellState,
            tasks,
          },
        },
      };
    });
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
          cleanupPromotedKeyMapByCellKey(cellKey);
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
          cleanupPromotedKeyMapByCellKey(cellKey);
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
    if (cellState.isPending) {
      get().startPendingUpload(
        cellState.tableId,
        cellState.recordId,
        cellState.fieldId,
        [task.file],
        cellState.baseId
      );
      return;
    }
    get().startUpload(
      cellState.tableId,
      cellState.recordId,
      cellState.fieldId,
      [task.file],
      cellState.baseId
    );
  },
}));
