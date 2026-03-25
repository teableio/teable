// for not introduce teable-core's package
export type ITableActionKey =
  | 'addRecord'
  | 'setRecord'
  | 'deleteRecord'
  | 'addField'
  | 'setField'
  | 'deleteField'
  | 'taskProcessing'
  | 'taskCompleted'
  | 'taskCancelled'
  | 'taskFailed';
