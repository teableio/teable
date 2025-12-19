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

export const splitDbTableName = (dbTableName: string): { schema: string; table: string } => {
  const dotIndex = dbTableName.indexOf('.');
  if (dotIndex === -1) return { schema: 'public', table: dbTableName };
  return {
    schema: dbTableName.slice(0, dotIndex),
    table: dbTableName.slice(dotIndex + 1),
  };
};
