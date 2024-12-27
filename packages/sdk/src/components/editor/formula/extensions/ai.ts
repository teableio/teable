import type { useFields } from '../../../../hooks/use-fields';

export const getFormulaPrompt = (prompt: string, fields: ReturnType<typeof useFields>) => {
  const context = fields.map((field) => `${field.id}: ${field.name}`).join('\n');
  return `
  you are a expert of airtable formula, especially good at writing formula.
  1. please generate a airtable formula based on the user's description.
  2. only return the formula, no need to explain. do not use \`\` to wrap it. when referencing by field name, use \`{}\` to wrap it.
  3. the field information of the current table is in the <fields> tag in the format of "fieldId: fieldName", please refer to the field information to generate the formula.
  4. the user's description is in the <prompt> tag.
  <fields>
  ${context}
  </fields>
  <prompt>
  ${prompt}
  </prompt>
  `;
};
