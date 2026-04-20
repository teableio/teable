import { ok } from 'neverthrow';

import type { UndoRedoStackService } from '../application/services/UndoRedoStackService';

const noopAppendResult = async () => ok(undefined);
const noopReplayResult = async () => ok(null);

/**
 * Centralized no-op undo/redo stack stub for command specs.
 *
 * Using a Proxy keeps tests resilient when the stack service gains additional
 * append-style methods. Replay-style methods still return `ok(null)` so undo/
 * redo call sites can safely inspect the result when needed.
 */
export const createNoopUndoRedoStackService = (): UndoRedoStackService =>
  new Proxy(
    {},
    {
      get: (_target, property) => {
        if (typeof property !== 'string') {
          return undefined;
        }
        if (
          property === 'undo' ||
          property === 'redo' ||
          property === 'applyUndo' ||
          property === 'applyRedo'
        ) {
          return noopReplayResult;
        }
        return noopAppendResult;
      },
    }
  ) as UndoRedoStackService;
