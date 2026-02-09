import type { ICreateTableRequestDto } from '@teable/v2-contract-http';

import type { SingleTableSeed } from '../types';
import { createFieldId, createSelectOption, singleTable } from '../utils';

const createProjectTrackerSeed = (): SingleTableSeed => {
  const itemFieldId = createFieldId();
  const statusFieldId = createFieldId();
  const startDateFieldId = createFieldId();
  const endDateFieldId = createFieldId();
  const ownerFieldId = createFieldId();
  const progressFieldId = createFieldId();
  const budgetFieldId = createFieldId();
  const notesFieldId = createFieldId();

  const statusOptions = [
    createSelectOption('Not Started', 'gray'),
    createSelectOption('In Progress', 'blue'),
    createSelectOption('Blocked', 'red'),
    createSelectOption('Done', 'green'),
  ];

  return {
    fields: [
      { type: 'singleLineText', id: itemFieldId, name: 'Item', isPrimary: true },
      {
        type: 'singleSelect',
        id: statusFieldId,
        name: 'Status',
        options: {
          choices: statusOptions,
          defaultValue: 'Not Started',
          preventAutoNewOptions: true,
        },
      },
      { type: 'date', id: startDateFieldId, name: 'Start Date' },
      { type: 'date', id: endDateFieldId, name: 'End Date' },
      { type: 'user', id: ownerFieldId, name: 'Owner', options: { isMultiple: false } },
      {
        type: 'number',
        id: progressFieldId,
        name: 'Progress',
        options: {
          showAs: {
            type: 'bar',
            color: 'teal',
            showValue: true,
            maxValue: 100,
          },
          defaultValue: 0,
        },
      },
      {
        type: 'number',
        id: budgetFieldId,
        name: 'Budget',
        options: { formatting: { type: 'currency', precision: 2, symbol: '$' } },
      },
      { type: 'longText', id: notesFieldId, name: 'Notes' },
    ],
    defaultRecordCount: 100,
    records: [
      {
        fields: {
          [itemFieldId]: 'Discovery',
          [statusFieldId]: statusOptions[0]!.id,
          [startDateFieldId]: '2025-02-01T00:00:00.000Z',
          [endDateFieldId]: '2025-02-05T00:00:00.000Z',
          [progressFieldId]: 10,
          [budgetFieldId]: 1200,
          [notesFieldId]: 'Stakeholder interviews.',
        },
      },
      {
        fields: {
          [itemFieldId]: 'Implementation',
          [statusFieldId]: statusOptions[1]!.id,
          [startDateFieldId]: '2025-02-06T00:00:00.000Z',
          [endDateFieldId]: '2025-02-20T00:00:00.000Z',
          [progressFieldId]: 45,
          [budgetFieldId]: 6400,
          [notesFieldId]: 'Build core workflows.',
        },
      },
      {
        fields: {
          [itemFieldId]: 'QA & Launch',
          [statusFieldId]: statusOptions[2]!.id,
          [startDateFieldId]: '2025-02-21T00:00:00.000Z',
          [endDateFieldId]: '2025-03-01T00:00:00.000Z',
          [progressFieldId]: 0,
          [budgetFieldId]: 2200,
          [notesFieldId]: 'Test and polish.',
        },
      },
    ],
  };
};

export const createProjectTrackerFields = (): ICreateTableRequestDto['fields'] =>
  createProjectTrackerSeed().fields;

export const projectTrackerTemplate = singleTable(
  'project-tracker',
  'Project Tracker',
  'Track work items with status, progress, and budget.',
  createProjectTrackerSeed,
  3
);
