import { Field, Record } from '@teable-group/sdk/model';

export async function tableContext2Prompt(tableId: string | undefined, viewId: string | undefined) {
  if (!tableId || !viewId) {
    return '';
  }

  const fields = await Field.getFields(tableId, viewId);
  const result = await Record.getRecords(tableId, { viewId, take: 1, skip: 0 });
  const fieldDefine = fields
    .map((field) => {
      return `${field.name}|${field.type}|${JSON.stringify(field.options)};`;
    })
    .join('\n');
  return `
Current table has ${fields.length} fields, and ${result.total} records.
Fields for current table is defined by following structure: {name}|{fieldType}|{options};
${fieldDefine}
`;
}
