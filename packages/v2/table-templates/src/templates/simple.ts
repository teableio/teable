import type { ICreateTableRequestDto } from '@teable/v2-contract-http';

import type { SingleTableSeed } from '../types';
import { createFieldId, singleTable } from '../utils';

const createSimpleSeed = (): SingleTableSeed => {
  const nameFieldId = createFieldId();
  const amountFieldId = createFieldId();
  const doneFieldId = createFieldId();

  return {
    fields: [
      { type: 'singleLineText', id: nameFieldId, name: 'Name' },
      { type: 'number', id: amountFieldId, name: 'Amount', options: { defaultValue: 1 } },
      { type: 'checkbox', id: doneFieldId, name: 'Done', options: { defaultValue: false } },
    ],
    defaultRecordCount: 12,
    records: [
      {
        fields: {
          [nameFieldId]: 'Launch',
          [amountFieldId]: 12,
          [doneFieldId]: true,
        },
      },
      {
        fields: {
          [nameFieldId]: 'Backlog Grooming',
          [amountFieldId]: 3,
          [doneFieldId]: false,
        },
      },
      {
        fields: {
          [nameFieldId]: 'Retro Notes',
          [amountFieldId]: 1,
          [doneFieldId]: false,
        },
      },
    ],
  };
};

export const createSimpleFields = (): ICreateTableRequestDto['fields'] => createSimpleSeed().fields;

export const simpleTableTemplate = singleTable(
  'simple-3',
  'Simple 3 Columns',
  'Single line text, number, and checkbox fields.',
  createSimpleSeed,
  3
);
