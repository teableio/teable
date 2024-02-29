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
