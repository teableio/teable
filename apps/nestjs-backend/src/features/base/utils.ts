function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceExpressionFieldIds(
  expression: string,
  fieldIdMap: { [oldFieldId: string]: string }
): string {
  const regex = /\{([a-z][a-z\d]*)\}/gi;
  return expression.replace(regex, (match, fieldId) => {
    return fieldIdMap[fieldId] ? `{${fieldIdMap[fieldId]}}` : match;
  });
}

export function replaceJsonStringFieldIds(
  jsonString: string | null,
  old2NewFieldMap: { [key: string]: string }
): string | null {
  const regex = /"fld[A-Za-z\d]{16}"/g;
  if (!jsonString) return jsonString;

  return jsonString.replace(regex, (match) => {
    const fieldId = match.slice(1, -1);
    const newFieldId = old2NewFieldMap[fieldId];
    return newFieldId ? `"${newFieldId}"` : match;
  });
}

export function replaceStringByMap(
  config: unknown,
  maps: Record<string, Record<string, string>>
): string | undefined;
export function replaceStringByMap(
  config: unknown,
  maps: Record<string, Record<string, string>>,
  returnJSONString: false
): unknown;
export function replaceStringByMap(
  config: unknown,
  maps: Record<string, Record<string, string>>,
  returnJSONString: boolean = true
): string | undefined | unknown {
  if (!config) {
    return;
  }

  let newConfigStr = JSON.stringify(config);

  for (const [, value] of Object.entries(maps)) {
    if (value) {
      Object.entries(value).forEach(([mapKey, mapValue]) => {
        newConfigStr = newConfigStr.replaceAll(new RegExp(escapeRegExp(mapKey), 'gi'), mapValue);
      });
    }
  }

  return returnJSONString ? newConfigStr : JSON.parse(newConfigStr);
}

export const replaceDefaultUrl = (
  defaultUrl: string,
  maps: Record<string, Record<string, string>>
) => {
  if (!defaultUrl) return defaultUrl;

  let newDefaultUrl = defaultUrl;

  for (const [, value] of Object.entries(maps)) {
    if (value) {
      Object.entries(value).forEach(([mapKey, mapValue]) => {
        newDefaultUrl = newDefaultUrl.replaceAll(mapKey, mapValue);
      });
    }
  }

  return newDefaultUrl;
};

export const mergeLinkFieldTableMaps = (
  map1: Record<
    string,
    { dbFieldName: string; selfKeyName: string; isMultipleCellValue: boolean }[]
  >,
  map2: Record<string, { dbFieldName: string; selfKeyName: string; isMultipleCellValue: boolean }[]>
) => {
  const merged = { ...map1 };
  Object.entries(map2).forEach(([tableId, fields]) => {
    merged[tableId] = [...(merged[tableId] || []), ...fields];
  });
  return merged;
};
