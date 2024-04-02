import { Field } from '@teable/sdk/model';

export async function tableContext2Prompt(tableId: string | undefined, viewId: string | undefined) {
  if (!tableId || !viewId) {
    return '';
  }

  const fields = (await Field.getFields(tableId, { viewId })).data;
  const fieldDefine = fields
    .map((field) => {
      return `${field.name}|${field.type}|${JSON.stringify(field.options)};`;
    })
    .join('\n');
  return `
Current table has ${fields.length} fields.
Fields for current table is defined by following structure: {name}|{fieldType}|{options};
${fieldDefine}
`;
}
