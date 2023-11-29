import Papa from 'papaparse';

const delimiter = '\t';
const newline = '\n';

export const parseClipboardText = (content: string) => {
  const { errors, data } = Papa.parse<string[]>(content, { delimiter, newline });
  return { error: errors[0]?.message, data };
};

export const stringifyClipboardText = (content: string[][]) => {
  return Papa.unparse<string[]>(content, { delimiter, newline });
};
