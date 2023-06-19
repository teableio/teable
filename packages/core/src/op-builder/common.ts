export enum OpName {
  AddTable = 'addTable',
  SetTableName = 'setTableName',
  SetTableOrder = 'setTableOrder',

  SetRecord = 'setRecord',
  SetRecordOrder = 'setRecordOrder',
  AddRecord = 'addRecord',
  DeleteRecord = 'deleteRecord',

  AddField = 'addField',
  SetFieldOrder = 'setFieldOrder',
  AddColumnMeta = 'addColumnMeta',
  SetColumnMeta = 'setColumnMeta',
  DeleteColumnMeta = 'deleteColumnMeta',
  DeleteField = 'deleteField',
  SetFieldName = 'setFieldName',
  SetFieldDescription = 'setFieldDescription',
  SetFieldOptions = 'setFieldOptions',
  SetFieldNotNull = 'setFieldNotNull',
  SetFieldUnique = 'setFieldUnique',
  SetFieldDefaultValue = 'setFieldDefaultValue',
  SetFieldType = 'setFieldType',

  AddView = 'addView',
  SetViewName = 'setViewName',
}

export function pathMatcher<T>(path: (string | number)[], matchList: string[]): T | null {
  const passIndex = matchList.findIndex((i) => i === '*');

  if (passIndex > -1) {
    if (path.length < passIndex) {
      return null;
    }
  } else if (path.length !== matchList.length) {
    return null;
  }

  const res: Record<string, string | number> = {};

  for (let i = 0; i < matchList.length; i++) {
    if (matchList[i].startsWith(':')) {
      const pathKey = matchList[i].slice(1);
      res[pathKey] = path[i];
      continue;
    }
    if (matchList[i] === '*') {
      continue;
    }
    if (path[i] !== matchList[i]) {
      return null;
    }
  }
  return res as T;
}
