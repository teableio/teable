// eslint-disable-next-line @typescript-eslint/no-explicit-any, sonarjs/cognitive-complexity
function replaceFieldIdsWithNames(obj: any, fieldMap: { [fieldId: string]: { name: string } }) {
  if (typeof obj === 'object' && obj !== null) {
    for (const key in obj) {
      // eslint-disable-next-line no-prototype-builtins
      if (obj.hasOwnProperty(key)) {
        let newKey = key;
        if (key.startsWith('fld') && fieldMap[key]) {
          newKey = fieldMap[key].name;
        }
        obj[newKey] = replaceFieldIdsWithNames(obj[key], fieldMap);
        if (newKey !== key) delete obj[key];
      }
    }
  } else if (typeof obj === 'string' && obj.startsWith('fld') && fieldMap[obj]) {
    obj = fieldMap[obj].name;
  }
  return obj;
}

export function nameConsole(
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj: any,
  fieldMap: { [fieldId: string]: { name: string } }
) {
  obj = JSON.parse(JSON.stringify(obj));
  console.log(key, JSON.stringify(replaceFieldIdsWithNames(obj, fieldMap), null, 2));
}
