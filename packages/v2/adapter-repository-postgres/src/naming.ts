/* eslint-disable @typescript-eslint/naming-convention */
import { slugify } from 'transliteration';

export const baseRecordColumnNames = [
  '__id',
  '__auto_number',
  '__created_time',
  '__last_modified_time',
  '__created_by',
  '__last_modified_by',
  '__version',
];

export const convertNameToValidCharacter = (name: string, maxLength = 40): string => {
  let cleanedName = slugify(name, { allowedChars: 'a-zA-Z0-9_', separator: '_', lowercase: false });

  if (cleanedName === '' || /^_+$/.test(cleanedName)) {
    return 'unnamed';
  }

  if (!/^[a-z]/i.test(cleanedName)) {
    cleanedName = `t${cleanedName}`;
  }

  return cleanedName.substring(0, maxLength);
};

export const joinDbTableName = (schemaName: string, tableName: string): string => {
  return `${schemaName}.${tableName}`;
};

export const ensureUniqueDbFieldName = (baseName: string, reservedNames: Set<string>): string => {
  if (!reservedNames.has(baseName)) return baseName;

  let suffix = 2;
  let candidate = `${baseName}_${suffix}`;
  while (reservedNames.has(candidate)) {
    suffix += 1;
    candidate = `${baseName}_${suffix}`;
  }

  return candidate;
};
