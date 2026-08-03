export const extractFieldReferences = (prompt: string): string[] => {
  const fieldRefRegex = /\{(fld[a-zA-Z0-9]+)\}/g;
  const fieldIds: string[] = [];
  let match;
  while ((match = fieldRefRegex.exec(prompt)) !== null) {
    fieldIds.push(match[1]);
  }
  return [...new Set(fieldIds)];
};
