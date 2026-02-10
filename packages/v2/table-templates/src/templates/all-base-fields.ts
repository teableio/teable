import type { ICreateTableRequestDto } from '@teable/v2-contract-http';

import type { SingleTableSeed } from '../types';
import { createFieldId, createSelectOption, singleTable } from '../utils';

const createAllBaseFieldsSeed = (): SingleTableSeed => {
  const nameFieldId = createFieldId();
  const descFieldId = createFieldId();
  const amountFieldId = createFieldId();
  const priorityFieldId = createFieldId();
  const statusFieldId = createFieldId();
  const tagsFieldId = createFieldId();
  const doneFieldId = createFieldId();
  const filesFieldId = createFieldId();
  const dueDateFieldId = createFieldId();
  const ownerFieldId = createFieldId();
  const actionFieldId = createFieldId();

  const statusOptions = [createSelectOption('Todo', 'blue'), createSelectOption('Done', 'green')];
  const tagOptions = [
    createSelectOption('Frontend', 'purple'),
    createSelectOption('Backend', 'teal'),
  ];

  return {
    fields: [
      { type: 'singleLineText', id: nameFieldId, name: 'Name' },
      {
        type: 'longText',
        id: descFieldId,
        name: 'Description',
        options: { defaultValue: 'Notes' },
      },
      { type: 'number', id: amountFieldId, name: 'Amount', options: { defaultValue: 10 } },
      {
        type: 'rating',
        id: priorityFieldId,
        name: 'Priority',
        max: 5,
        options: { icon: 'star', color: 'yellowBright' },
      },
      {
        type: 'singleSelect',
        id: statusFieldId,
        name: 'Status',
        options: { choices: statusOptions },
      },
      {
        type: 'multipleSelect',
        id: tagsFieldId,
        name: 'Tags',
        options: { choices: tagOptions },
      },
      { type: 'checkbox', id: doneFieldId, name: 'Done', options: { defaultValue: true } },
      { type: 'attachment', id: filesFieldId, name: 'Files' },
      { type: 'date', id: dueDateFieldId, name: 'Due Date' },
      { type: 'user', id: ownerFieldId, name: 'Owner', options: { isMultiple: false } },
      { type: 'button', id: actionFieldId, name: 'Action', options: { label: 'Run' } },
    ],
    defaultRecordCount: 20,
    records: [
      {
        fields: {
          [nameFieldId]: 'Feature Launch',
          [descFieldId]: 'Prepare release notes',
          [amountFieldId]: 10,
          [priorityFieldId]: 4,
          [statusFieldId]: statusOptions[0]!.id,
          [tagsFieldId]: [tagOptions[0]!.id],
          [doneFieldId]: false,
          [dueDateFieldId]: '2025-02-10T00:00:00.000Z',
        },
      },
      {
        fields: {
          [nameFieldId]: 'Bug Scrub',
          [descFieldId]: 'Fix top issues',
          [amountFieldId]: 3,
          [priorityFieldId]: 5,
          [statusFieldId]: statusOptions[1]!.id,
          [tagsFieldId]: [tagOptions[1]!.id],
          [doneFieldId]: true,
          [dueDateFieldId]: '2025-02-05T00:00:00.000Z',
        },
      },
      {
        fields: {
          [nameFieldId]: 'Docs Refresh',
          [descFieldId]: 'Update onboarding',
          [amountFieldId]: 2,
          [priorityFieldId]: 3,
          [statusFieldId]: statusOptions[0]!.id,
          [tagsFieldId]: [tagOptions[0]!.id, tagOptions[1]!.id],
          [doneFieldId]: false,
          [dueDateFieldId]: '2025-02-15T00:00:00.000Z',
        },
      },
    ],
  };
};

export const createAllBaseFields = (): ICreateTableRequestDto['fields'] =>
  createAllBaseFieldsSeed().fields;

export const allBaseFieldsTemplate = singleTable(
  'all-base-fields',
  'All Base Fields',
  'Common field types without formulas.',
  createAllBaseFieldsSeed,
  3
);
