import type { ICreateTableRequestDto, ICreateTablesRequestDto } from '@teable/v2-contract-http';

import type { CreateTableTemplateInputOptions, TableTemplateDefinition } from '../types';
import { createFieldId, createSelectOption } from '../utils';

/**
 * Teable's default blank table, mirroring v1's API-layer defaults
 * (nestjs-backend features/table/constant.ts): Name / Count / Status fields,
 * a grid view, and exactly 3 empty records (T6520 parity). Hand-crafted
 * instead of using `singleTable` because the seed intentionally carries
 * exactly 3 empty records, below MIN_TEMPLATE_RECORDS.
 */

const DEFAULT_TABLE_NAME = 'Table';
const DEFAULT_RECORD_COUNT = 3;

export const createDefaultTableFields = (): NonNullable<ICreateTableRequestDto['fields']> => [
  { type: 'singleLineText', id: createFieldId(), name: 'Name' },
  { type: 'number', id: createFieldId(), name: 'Count' },
  {
    type: 'singleSelect',
    id: createFieldId(),
    name: 'Status',
    options: {
      choices: [
        createSelectOption('light', 'grayBright'),
        createSelectOption('medium', 'yellowBright'),
        createSelectOption('heavy', 'tealBright'),
      ],
    },
  },
];

export const createDefaultTableRecords = (): NonNullable<ICreateTableRequestDto['records']> =>
  Array.from({ length: DEFAULT_RECORD_COUNT }, () => ({ fields: {} }));

export const defaultTableTemplate: TableTemplateDefinition = {
  key: 'default',
  name: 'Default',
  description: 'Blank table with Name, Count and Status fields and 3 empty records.',
  defaultRecordCount: DEFAULT_RECORD_COUNT,
  tables: [
    {
      key: 'default',
      name: DEFAULT_TABLE_NAME,
      description: 'Blank table with Name, Count and Status fields.',
      fieldCount: 3,
      defaultRecordCount: DEFAULT_RECORD_COUNT,
    },
  ],
  createInput: (
    baseId: string,
    options?: CreateTableTemplateInputOptions
  ): ICreateTablesRequestDto => ({
    baseId,
    tables: [
      {
        name: options?.namePrefix?.trim() || DEFAULT_TABLE_NAME,
        fields: createDefaultTableFields(),
        views: [{ type: 'grid', name: 'Grid view' }],
        // The empty records are the template's content: include them unless
        // the caller explicitly opts out.
        records: options?.includeRecords ?? true ? createDefaultTableRecords() : undefined,
      },
    ],
  }),
};
