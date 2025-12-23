/* eslint-disable sonarjs/no-duplicate-string */
import type { ICreateTableRequestDto } from '@teable/v2-contract-http';
import { FieldId } from '@teable/v2-core';

export type TableTemplateDefinition = {
  key: string;
  name: string;
  description: string;
  createFields: () => ICreateTableRequestDto['fields'];
  createInput: (baseId: string, name: string) => ICreateTableRequestDto;
};

const createTemplate = (
  key: string,
  name: string,
  description: string,
  createFields: () => ICreateTableRequestDto['fields']
): TableTemplateDefinition => ({
  key,
  name,
  description,
  createFields,
  createInput: (baseId: string, tableName: string) => ({
    baseId,
    name: tableName,
    fields: createFields(),
  }),
});

const createFieldId = (): string => FieldId.mustGenerate().toString();

export const createSimpleFields = (): ICreateTableRequestDto['fields'] => [
  { type: 'singleLineText', name: 'Name' },
  { type: 'number', name: 'Amount', options: { defaultValue: 1 } },
  { type: 'checkbox', name: 'Done', options: { defaultValue: false } },
];

export const createAllBaseFields = (): ICreateTableRequestDto['fields'] => [
  { type: 'singleLineText', name: 'Name' },
  { type: 'longText', name: 'Description', options: { defaultValue: 'Notes' } },
  { type: 'number', name: 'Amount', options: { defaultValue: 10 } },
  { type: 'rating', name: 'Priority', max: 5, options: { icon: 'star', color: 'yellowBright' } },
  { type: 'singleSelect', name: 'Status', options: ['Todo', 'Done'] },
  { type: 'multipleSelect', name: 'Tags', options: ['Frontend', 'Backend'] },
  { type: 'checkbox', name: 'Done', options: { defaultValue: true } },
  { type: 'attachment', name: 'Files' },
  { type: 'date', name: 'Due Date' },
  { type: 'user', name: 'Owner', options: { isMultiple: false } },
  { type: 'button', name: 'Action', options: { label: 'Run' } },
];

export const createTodoFields = (): ICreateTableRequestDto['fields'] => [
  { type: 'singleLineText', name: 'Task', isPrimary: true },
  { type: 'longText', name: 'Notes' },
  {
    type: 'singleSelect',
    name: 'Status',
    options: {
      choices: [
        { name: 'Todo', color: 'blue' },
        { name: 'In Progress', color: 'yellow' },
        { name: 'Blocked', color: 'red' },
        { name: 'Done', color: 'green' },
      ],
      defaultValue: 'Todo',
      preventAutoNewOptions: true,
    },
  },
  { type: 'rating', name: 'Priority', max: 5, options: { icon: 'star', color: 'yellowBright' } },
  { type: 'date', name: 'Due Date' },
  { type: 'user', name: 'Assignee', options: { isMultiple: false } },
  {
    type: 'multipleSelect',
    name: 'Tags',
    options: {
      choices: [
        { name: 'Work', color: 'purple' },
        { name: 'Personal', color: 'teal' },
        { name: 'Errand', color: 'orange' },
      ],
    },
  },
  { type: 'checkbox', name: 'Done', options: { defaultValue: false } },
];

export const createBugTriageFields = (): ICreateTableRequestDto['fields'] => [
  { type: 'singleLineText', name: 'Title', isPrimary: true },
  {
    type: 'singleSelect',
    name: 'Severity',
    options: {
      choices: [
        { name: 'Low', color: 'green' },
        { name: 'Medium', color: 'yellow' },
        { name: 'High', color: 'orange' },
        { name: 'Critical', color: 'red' },
      ],
      defaultValue: 'Medium',
      preventAutoNewOptions: true,
    },
  },
  {
    type: 'singleSelect',
    name: 'Status',
    options: {
      choices: [
        { name: 'New', color: 'blue' },
        { name: 'Triaged', color: 'yellow' },
        { name: 'In Progress', color: 'purple' },
        { name: 'Fixed', color: 'green' },
        { name: "Won't Fix", color: 'gray' },
      ],
      defaultValue: 'New',
      preventAutoNewOptions: true,
    },
  },
  { type: 'singleLineText', name: 'Environment' },
  { type: 'longText', name: 'Steps to Repro' },
  { type: 'checkbox', name: 'Reproducible', options: { defaultValue: true } },
  { type: 'date', name: 'Reported At' },
  { type: 'user', name: 'Owner', options: { isMultiple: false } },
];

export const createContentCalendarFields = (): ICreateTableRequestDto['fields'] => [
  { type: 'singleLineText', name: 'Title', isPrimary: true },
  {
    type: 'singleSelect',
    name: 'Channel',
    options: {
      choices: [
        { name: 'Blog', color: 'purple' },
        { name: 'Newsletter', color: 'blue' },
        { name: 'Social', color: 'teal' },
        { name: 'Webinar', color: 'orange' },
      ],
      defaultValue: 'Blog',
      preventAutoNewOptions: true,
    },
  },
  {
    type: 'singleSelect',
    name: 'Status',
    options: {
      choices: [
        { name: 'Draft', color: 'gray' },
        { name: 'Review', color: 'yellow' },
        { name: 'Scheduled', color: 'blue' },
        { name: 'Published', color: 'green' },
      ],
      defaultValue: 'Draft',
      preventAutoNewOptions: true,
    },
  },
  { type: 'date', name: 'Publish Date' },
  { type: 'user', name: 'Owner', options: { isMultiple: false } },
  { type: 'singleLineText', name: 'Asset URL', options: { showAs: { type: 'url' } } },
  { type: 'longText', name: 'Summary' },
];

export const createProjectTrackerFields = (): ICreateTableRequestDto['fields'] => [
  { type: 'singleLineText', name: 'Item', isPrimary: true },
  {
    type: 'singleSelect',
    name: 'Status',
    options: {
      choices: [
        { name: 'Not Started', color: 'gray' },
        { name: 'In Progress', color: 'blue' },
        { name: 'Blocked', color: 'red' },
        { name: 'Done', color: 'green' },
      ],
      defaultValue: 'Not Started',
      preventAutoNewOptions: true,
    },
  },
  { type: 'date', name: 'Start Date' },
  { type: 'date', name: 'End Date' },
  { type: 'user', name: 'Owner', options: { isMultiple: false } },
  {
    type: 'number',
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
    name: 'Budget',
    options: { formatting: { type: 'currency', precision: 2, symbol: '$' } },
  },
  { type: 'longText', name: 'Notes' },
];

export const createPersonalFinanceFields = (): ICreateTableRequestDto['fields'] => [
  { type: 'date', name: 'Date' },
  { type: 'singleLineText', name: 'Description', isPrimary: true },
  {
    type: 'singleSelect',
    name: 'Category',
    options: {
      choices: [
        { name: 'Income', color: 'green' },
        { name: 'Housing', color: 'blue' },
        { name: 'Food', color: 'orange' },
        { name: 'Travel', color: 'purple' },
        { name: 'Utilities', color: 'teal' },
        { name: 'Other', color: 'gray' },
      ],
      defaultValue: 'Other',
      preventAutoNewOptions: true,
    },
  },
  {
    type: 'singleSelect',
    name: 'Type',
    options: {
      choices: [
        { name: 'Debit', color: 'red' },
        { name: 'Credit', color: 'green' },
      ],
      defaultValue: 'Debit',
      preventAutoNewOptions: true,
    },
  },
  {
    type: 'number',
    name: 'Amount',
    options: { formatting: { type: 'currency', precision: 2, symbol: '$' } },
  },
  {
    type: 'singleSelect',
    name: 'Account',
    options: {
      choices: [
        { name: 'Cash', color: 'gray' },
        { name: 'Bank', color: 'blue' },
        { name: 'Card', color: 'purple' },
      ],
      defaultValue: 'Bank',
      preventAutoNewOptions: true,
    },
  },
  { type: 'checkbox', name: 'Cleared', options: { defaultValue: false } },
  { type: 'longText', name: 'Notes' },
];

export const createAllFieldTypesFields = (): ICreateTableRequestDto['fields'] => {
  const amountFieldId = createFieldId();
  const scoreFieldId = createFieldId();
  const scoreLabelFieldId = createFieldId();

  return [
    {
      type: 'singleLineText',
      name: 'Name',
      options: { showAs: { type: 'email' }, defaultValue: 'owner@example.com' },
    },
    { type: 'longText', name: 'Description', options: { defaultValue: 'Details' } },
    {
      type: 'number',
      id: amountFieldId,
      name: 'Amount',
      options: {
        formatting: { type: 'currency', precision: 2, symbol: '$' },
        showAs: {
          type: 'bar',
          color: 'teal',
          showValue: true,
          maxValue: 100,
        },
        defaultValue: 10,
      },
    },
    {
      type: 'formula',
      id: scoreFieldId,
      name: 'Score',
      options: {
        expression: `{${amountFieldId}} * 2`,
        formatting: { type: 'decimal', precision: 0 },
      },
    },
    {
      type: 'formula',
      id: scoreLabelFieldId,
      name: 'Score Label',
      options: {
        expression: `CONCATENATE("Score: ", {${scoreFieldId}})`,
      },
    },
    {
      type: 'rating',
      name: 'Priority',
      options: { max: 5, icon: 'star', color: 'yellowBright' },
    },
    {
      type: 'singleSelect',
      name: 'Status',
      options: {
        choices: [
          { name: 'Todo', color: 'blue' },
          { name: 'Doing', color: 'yellow' },
          { name: 'Done', color: 'green' },
        ],
        defaultValue: 'Todo',
        preventAutoNewOptions: true,
      },
    },
    {
      type: 'multipleSelect',
      name: 'Tags',
      options: {
        choices: [
          { name: 'Frontend', color: 'purple' },
          { name: 'Backend', color: 'orange' },
          { name: 'Bug', color: 'red' },
        ],
        defaultValue: ['Frontend', 'Bug'],
      },
    },
    { type: 'checkbox', name: 'Done', options: { defaultValue: true } },
    { type: 'attachment', name: 'Files' },
    {
      type: 'date',
      name: 'Due Date',
      options: {
        formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
        defaultValue: 'now',
      },
    },
    {
      type: 'user',
      name: 'Owner',
      options: { isMultiple: true, shouldNotify: false, defaultValue: ['me'] },
    },
    {
      type: 'button',
      name: 'Action',
      options: {
        label: 'Run',
        color: 'teal',
        maxCount: 3,
        resetCount: true,
        workflow: { id: 'wflaaaaaaaaaaaaaaaa', name: 'Deploy', isActive: true },
      },
    },
  ];
};

export const createTextColumns = (count: number): ICreateTableRequestDto['fields'] =>
  Array.from({ length: count }, (_, index) => ({
    type: 'singleLineText',
    name: `Column ${index + 1}`,
  }));

export const simpleTableTemplate = createTemplate(
  'simple-3',
  'Simple 3 Columns',
  'Single line text, number, and checkbox fields.',
  createSimpleFields
);

export const allBaseFieldsTemplate = createTemplate(
  'all-base-fields',
  'All Base Fields',
  'Common field types without formulas.',
  createAllBaseFields
);

export const todoTemplate = createTemplate(
  'todo',
  'Todo List',
  'Simple tasks with status, priority, and due dates.',
  createTodoFields
);

export const bugTriageTemplate = createTemplate(
  'bug-triage',
  'Bug Triage',
  'Track bugs with severity, status, and ownership.',
  createBugTriageFields
);

export const contentCalendarTemplate = createTemplate(
  'content-calendar',
  'Content Calendar',
  'Plan content with channels, status, and publish dates.',
  createContentCalendarFields
);

export const projectTrackerTemplate = createTemplate(
  'project-tracker',
  'Project Tracker',
  'Track work items with status, progress, and budget.',
  createProjectTrackerFields
);

export const personalFinanceTemplate = createTemplate(
  'personal-finance',
  'Personal Finance',
  'Log transactions with categories, amounts, and accounts.',
  createPersonalFinanceFields
);

export const allFieldTypesTemplate = createTemplate(
  'all-field-types',
  'All Field Types',
  'Every field type with richer options and formulas.',
  createAllFieldTypesFields
);

export const tableTemplates = [
  simpleTableTemplate,
  allBaseFieldsTemplate,
  todoTemplate,
  bugTriageTemplate,
  contentCalendarTemplate,
  projectTrackerTemplate,
  personalFinanceTemplate,
  allFieldTypesTemplate,
] as const;

export type TableTemplateKey = (typeof tableTemplates)[number]['key'];

export const getTableTemplate = (key: TableTemplateKey): TableTemplateDefinition | undefined =>
  tableTemplates.find((template) => template.key === key);
