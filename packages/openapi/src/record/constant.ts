export enum CreateRecordAction {
  Import = 'table.import',
  InplaceImport = 'table.inplace-import',

  BaseImport = 'base.import',
  BaseDuplicate = 'base.duplicate',

  TemplateApply = 'template.apply',

  RecordPaste = 'table.record.paste.create',

  AutomationRecordCreate = 'automation.record.create',

  AiRecordCreate = 'ai.record.create',

  FormSubmit = 'form.record.submit',

  TableDuplicate = 'table.duplicate',

  CreateDefaultRecords = 'table.default-records.create',

  AppRecordCreate = 'app.record.create',
}

export enum UpdateRecordAction {
  // record update
  RecordUpdate = 'table.record.update',

  // paste record
  PasteRecord = 'table.record.paste.update',

  // automation record update
  AutomationRecordUpdate = 'automation.record.update',

  // ai record update
  AiRecordUpdate = 'ai.record.update',

  AppRecordUpdate = 'app.record.update',
}
