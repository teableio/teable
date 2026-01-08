import type { ICreateTableRequestDto } from '@teable/v2-contract-http';

import type { SingleTableSeed } from '../types';
import { createFieldId, createSelectOption, singleTable } from '../utils';

const createTodoSeed = (): SingleTableSeed => {
  const taskFieldId = createFieldId();
  const notesFieldId = createFieldId();
  const statusFieldId = createFieldId();
  const priorityFieldId = createFieldId();
  const dueDateFieldId = createFieldId();
  const assigneeFieldId = createFieldId();
  const tagsFieldId = createFieldId();
  const doneFieldId = createFieldId();

  const statusOptions = [
    createSelectOption('Todo', 'blue'),
    createSelectOption('In Progress', 'yellow'),
    createSelectOption('Blocked', 'red'),
    createSelectOption('Done', 'green'),
  ];
  const tagOptions = [
    createSelectOption('Work', 'purple'),
    createSelectOption('Personal', 'teal'),
    createSelectOption('Errand', 'orange'),
  ];

  return {
    fields: [
      { type: 'singleLineText', id: taskFieldId, name: 'Task', isPrimary: true },
      { type: 'longText', id: notesFieldId, name: 'Notes' },
      {
        type: 'singleSelect',
        id: statusFieldId,
        name: 'Status',
        options: {
          choices: statusOptions,
          defaultValue: 'Todo',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'rating',
        id: priorityFieldId,
        name: 'Priority',
        max: 5,
        options: { icon: 'star', color: 'yellowBright' },
      },
      { type: 'date', id: dueDateFieldId, name: 'Due Date' },
      { type: 'user', id: assigneeFieldId, name: 'Assignee', options: { isMultiple: false } },
      {
        type: 'multipleSelect',
        id: tagsFieldId,
        name: 'Tags',
        options: {
          choices: tagOptions,
        },
      },
      { type: 'checkbox', id: doneFieldId, name: 'Done', options: { defaultValue: false } },
    ],
    defaultRecordCount: 30,
    records: [
      {
        fields: {
          [taskFieldId]: 'Design kickoff',
          [statusFieldId]: statusOptions[0]!.id,
          [priorityFieldId]: 4,
          [tagsFieldId]: [tagOptions[0]!.id],
          [doneFieldId]: false,
          [dueDateFieldId]: '2025-02-03T00:00:00.000Z',
        },
      },
      {
        fields: {
          [taskFieldId]: 'Implement auth',
          [statusFieldId]: statusOptions[1]!.id,
          [priorityFieldId]: 5,
          [tagsFieldId]: [tagOptions[0]!.id],
          [doneFieldId]: false,
          [dueDateFieldId]: '2025-02-06T00:00:00.000Z',
        },
      },
      {
        fields: {
          [taskFieldId]: 'Fix regression',
          [statusFieldId]: statusOptions[2]!.id,
          [priorityFieldId]: 3,
          [tagsFieldId]: [tagOptions[2]!.id],
          [doneFieldId]: false,
          [dueDateFieldId]: '2025-02-04T00:00:00.000Z',
        },
      },
      {
        fields: {
          [taskFieldId]: 'Ship release',
          [statusFieldId]: statusOptions[3]!.id,
          [priorityFieldId]: 5,
          [tagsFieldId]: [tagOptions[0]!.id, tagOptions[1]!.id],
          [doneFieldId]: true,
          [dueDateFieldId]: '2025-02-08T00:00:00.000Z',
        },
      },
    ],
  };
};

export const createTodoFields = (): ICreateTableRequestDto['fields'] => createTodoSeed().fields;

export const todoTemplate = singleTable(
  'todo',
  'Todo List',
  'Simple tasks with status, priority, and due dates.',
  createTodoSeed,
  4
);
