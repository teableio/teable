import { normalizeCellDisplayValue, normalizeCellDisplayValues } from './normalizeCellDisplayValue';

/**
 * CSV field splitter aligned with text → multipleSelect conversion SQL:
 * ` *(?:"([^"]*)"|([^,\n\r]+))`.
 * Quoted commas stay inside one choice; surrounding quotes are not stored.
 */
const quotedCommaSplit = / *(?:"([^"]*)"|([^,\n\r]+))/g;

export const splitQuotedCommaSeparatedValues = (value: string): string[] => {
  const results: string[] = [];
  for (const match of value.matchAll(quotedCommaSplit)) {
    const token = (match[1] ?? match[2] ?? '').trim();
    if (token.length > 0) {
      results.push(token);
    }
  }
  return results;
};

export const splitSelectTypecastValues = (value: unknown): string[] => {
  if (value == null) return [];
  if (typeof value === 'string') {
    return splitQuotedCommaSeparatedValues(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeCellDisplayValue(item))
      .filter((item): item is string => item != null);
  }
  return normalizeCellDisplayValues(value);
};
