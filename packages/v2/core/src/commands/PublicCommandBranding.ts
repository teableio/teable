import type { IPublicCommand } from '../ports/CommandBus';

declare module './TableUpdateCommand' {
  interface TableUpdateCommand extends IPublicCommand {}
}

declare module './ApplyRecordOrdersCommand' {
  interface ApplyRecordOrdersCommand extends IPublicCommand {}
}

declare module './ClearCommand' {
  interface ClearCommand extends IPublicCommand {}
}

declare module './CreateBaseCommand' {
  interface CreateBaseCommand extends IPublicCommand {}
}

declare module './CreateRecordCommand' {
  interface CreateRecordCommand extends IPublicCommand {}
}

declare module './CreateRecordsCommand' {
  interface CreateRecordsCommand extends IPublicCommand {}
}

declare module './CreateRecordsStreamCommand' {
  interface CreateRecordsStreamCommand extends IPublicCommand {}
}

declare module './CreateTableCommand' {
  interface CreateTableCommand extends IPublicCommand {}
}

declare module './CreateTablesCommand' {
  interface CreateTablesCommand extends IPublicCommand {}
}

declare module './DeleteByRangeCommand' {
  interface DeleteByRangeCommand extends IPublicCommand {}
}

declare module './DeleteByRangeStreamCommand' {
  interface DeleteByRangeStreamCommand extends IPublicCommand {}
}

declare module './DeleteRecordsCommand' {
  interface DeleteRecordsCommand extends IPublicCommand {}
}

declare module './DeleteTableCommand' {
  interface DeleteTableCommand extends IPublicCommand {}
}

declare module './DuplicateRecordCommand' {
  interface DuplicateRecordCommand extends IPublicCommand {}
}

declare module './DuplicateRecordsStreamCommand' {
  interface DuplicateRecordsStreamCommand extends IPublicCommand {}
}

declare module './PasteStreamCommand' {
  interface PasteStreamCommand extends IPublicCommand {}
}

declare module './DuplicateTableCommand' {
  interface DuplicateTableCommand extends IPublicCommand {}
}

declare module './ImportCsvCommand' {
  interface ImportCsvCommand extends IPublicCommand {}
}

declare module './ImportDotTeaStructureCommand' {
  interface ImportDotTeaStructureCommand extends IPublicCommand {}
}

declare module './ImportRecordsCommand' {
  interface ImportRecordsCommand extends IPublicCommand {}
}

declare module './PasteCommand' {
  interface PasteCommand extends IPublicCommand {}
}

declare module './RedoCommand' {
  interface RedoCommand extends IPublicCommand {}
}

declare module './ReorderRecordsCommand' {
  interface ReorderRecordsCommand extends IPublicCommand {}
}

declare module './RestoreRecordsCommand' {
  interface RestoreRecordsCommand extends IPublicCommand {}
}

declare module './RestoreRecordsStreamCommand' {
  interface RestoreRecordsStreamCommand extends IPublicCommand {}
}

declare module './RestoreTableCommand' {
  interface RestoreTableCommand extends IPublicCommand {}
}

declare module './SubmitRecordCommand' {
  interface SubmitRecordCommand extends IPublicCommand {}
}

declare module './UndoCommand' {
  interface UndoCommand extends IPublicCommand {}
}

declare module './UpdateFieldCommand' {
  interface UpdateFieldCommand extends IPublicCommand {}
}

declare module './UpdateRecordCommand' {
  interface UpdateRecordCommand extends IPublicCommand {}
}

declare module './UpdateRecordsCommand' {
  interface UpdateRecordsCommand extends IPublicCommand {}
}
