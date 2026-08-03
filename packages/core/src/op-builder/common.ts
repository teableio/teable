export enum OpName {
  AddTable = 'addTable',
  SetTableProperty = 'setTableProperty',

  SetRecord = 'setRecord',
  AddRecord = 'addRecord',

  AddField = 'addField',
  AddColumnMeta = 'addColumnMeta',
  DeleteColumnMeta = 'deleteColumnMeta',
  SetFieldProperty = 'setFieldProperty',

  AddView = 'addView',
  SetViewProperty = 'setViewProperty',
  UpdateViewColumnMeta = 'updateViewColumnMeta',
}

export function pathMatcher<T>(path: (string | number)[], matchList: string[]): T | null {
  if (path.length !== matchList.length) {
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
