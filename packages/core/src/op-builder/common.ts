export enum OpName {
  SetRecord,
  AddRecord,
  DeleteRecord,
  AddRow,
  DeleteRow,
}

export function pathMatcher<T>(path: (string | number)[], matchList: string[]): T | false {
  const passIndex = matchList.findIndex((i) => i === '*');

  if (passIndex > -1) {
    if (path.length < passIndex) {
      return false;
    }
  } else if (path.length !== matchList.length) {
    return false;
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
      return false;
    }
  }
  return res as T;
}
