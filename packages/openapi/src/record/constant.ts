export enum CreateRecordAction {
  Import = 'table.import',
  InplaceImport = 'table.inplace-import',

  BaseImport = 'base.import',
  BaseDuplicate = 'base.duplicate',

  TemplateApply = 'template.apply',
  ShareBaseCopy = 'share.base.copy',

  RecordPaste = 'table.record.paste.create',

  FormSubmit = 'form.record.submit',

  TableDuplicate = 'table.duplicate',

  CreateDefaultRecords = 'table.default-records.create',
}

export enum UpdateRecordAction {
  // record update
  RecordUpdate = 'table.record.update',

  // paste record
  PasteRecord = 'table.record.paste.update',
}
