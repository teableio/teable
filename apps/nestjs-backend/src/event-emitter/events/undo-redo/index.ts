import type { IUndoRedoOperation } from '../../../cache/types';
import { Events } from '../event.enum';

export class UndoEvent {
  public readonly name = Events.UNDO;

  constructor(public readonly operation: IUndoRedoOperation) {}
}

export class RedoEvent {
  public readonly name = Events.REDO;

  constructor(public readonly operation: IUndoRedoOperation) {}
}
