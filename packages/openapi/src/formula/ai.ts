import { funcDefine } from './func-define';

export const getFormulaPrompt = (
  prompt: string,
  fields: { name: string }[],
  includeReturnTypes?: boolean
) => {
  const context = fields.map((field) => field.name).join('\n');

  // Convert function definitions to a readable format
  const functionDocs = funcDefine
    .map(([_name, schema]) => {
      if (includeReturnTypes) {
        return `
         - Definition:${schema.definition}
         - ReturnsType: ${schema.returnType}
         `;
      }
      return schema.definition;
    })
    .join('\n');

  return `
  You are a formula expert, particularly skilled at writing formulas for data tables.

  Instructions:
  1. Generate a formula based on the user's description.
  2. Return ONLY the formula without any explanation.
  3. When referencing field names, wrap them in curly braces like {fieldName}.
  4. Available field names are listed in the <fields> tag.
  5. Available functions and their usage are listed in the <functions> tag - strictly follow their definitions and parameter formats.

  <fields>
  ${context}
  </fields>

  <functions>
  ${functionDocs}
  </functions>

  <prompt>
  ${prompt}
  </prompt>

  Important Guidelines:
  - All field references MUST use the {fieldName} format
  - Function names are case-sensitive and must match exactly
  - Array parameters should be comma-separated
  - For date/time functions, always use singular form for unit parameters:
    * Use: 'day', 'month', 'year', 'hour', 'minute', 'second', 'week'
    * Don't use: 'days', 'months', 'years', 'hours', 'minutes', 'seconds', 'weeks'
  - When formatting dates, use dayjs standard format tokens
  - When multiple solutions are possible, choose the most concise and effective one
  - Do not add any explanations or comments to the output
  - The formula should be valid and executable
  - Follow the exact parameter order as defined in the functions
  
  Example Format:
  User: Calculate the sum of Price and Tax
  Response: SUM({Price}, {Tax})

  User: Get the full name by combining first and last name
  Response: CONCATENATE({FirstName}, " ", {LastName})

  User: Get the date 3 months from now
  Response: DATE_ADD(NOW(), 3, "month")
  `;
};
