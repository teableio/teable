/* eslint-disable sonarjs/no-duplicate-string */
import type { ICreateTableRequestDto } from '@teable/v2-contract-http';
import { FieldId, SelectOptionId, type FieldColorValue } from '@teable/v2-core';

export type TableTemplateDefinition = {
  key: string;
  name: string;
  description: string;
  defaultRecordCount?: number;
  createFields: () => ICreateTableRequestDto['fields'];
  createInput: (
    baseId: string,
    name: string,
    options?: CreateTableTemplateInputOptions
  ) => ICreateTableRequestDto;
};

export type CreateTableTemplateInputOptions = {
  includeRecords?: boolean;
  recordCount?: number;
};

type TableTemplateSeed = {
  fields: ICreateTableRequestDto['fields'];
  records?: ICreateTableRequestDto['records'];
};

type TemplateRecord = NonNullable<ICreateTableRequestDto['records']>[number];

const createTemplate = (
  key: string,
  name: string,
  description: string,
  buildSeed: () => TableTemplateSeed,
  defaultRecordCount?: number
): TableTemplateDefinition => ({
  key,
  name,
  description,
  defaultRecordCount,
  createFields: () => buildSeed().fields,
  createInput: (baseId: string, tableName: string, options?: CreateTableTemplateInputOptions) => {
    const seed = buildSeed();
    const seedRecords = seed.records;
    const canIncludeRecords = Boolean(seedRecords && seedRecords.length > 0);
    const includeRecords = options?.includeRecords ?? false;
    const recordCount = options?.recordCount ?? seedRecords?.length ?? 0;
    const records =
      includeRecords && canIncludeRecords && recordCount > 0
        ? [...normalizeTemplateRecords(seedRecords ?? [], recordCount)]
        : undefined;
    return {
      baseId,
      name: tableName,
      fields: seed.fields,
      ...(records ? { records } : {}),
    };
  },
});

const createFieldId = (): string => FieldId.mustGenerate().toString();
const createSelectOptionId = (): string => {
  const idResult = SelectOptionId.generate();
  if (idResult.isOk()) return idResult.value.toString();
  const fallback = Math.random().toString(36).slice(2, 10).padEnd(8, '0').slice(0, 8);
  return `cho${fallback}`;
};
const createSelectOption = (name: string, color: FieldColorValue) => ({
  id: createSelectOptionId(),
  name,
  color,
});

const normalizeTemplateRecords = (
  records: ReadonlyArray<TemplateRecord>,
  recordCount: number
): ReadonlyArray<TemplateRecord> => {
  if (recordCount <= 0) return [];
  if (records.length >= recordCount) return records.slice(0, recordCount);
  const missing = recordCount - records.length;
  const emptyRecords = Array.from({ length: missing }, () => ({ fields: {} }));
  return [...records, ...emptyRecords];
};

const createSimpleSeed = (): TableTemplateSeed => {
  const nameFieldId = createFieldId();
  const amountFieldId = createFieldId();
  const doneFieldId = createFieldId();

  return {
    fields: [
      { type: 'singleLineText', id: nameFieldId, name: 'Name' },
      { type: 'number', id: amountFieldId, name: 'Amount', options: { defaultValue: 1 } },
      { type: 'checkbox', id: doneFieldId, name: 'Done', options: { defaultValue: false } },
    ],
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

const createAllBaseFieldsSeed = (): TableTemplateSeed => {
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

const createTodoSeed = (): TableTemplateSeed => {
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

const createBugTriageSeed = (): TableTemplateSeed => {
  const titleFieldId = createFieldId();
  const severityFieldId = createFieldId();
  const statusFieldId = createFieldId();
  const environmentFieldId = createFieldId();
  const stepsFieldId = createFieldId();
  const reproducibleFieldId = createFieldId();
  const reportedAtFieldId = createFieldId();
  const ownerFieldId = createFieldId();

  const severityOptions = [
    createSelectOption('Low', 'green'),
    createSelectOption('Medium', 'yellow'),
    createSelectOption('High', 'orange'),
    createSelectOption('Critical', 'red'),
  ];
  const statusOptions = [
    createSelectOption('New', 'blue'),
    createSelectOption('Triaged', 'yellow'),
    createSelectOption('In Progress', 'purple'),
    createSelectOption('Fixed', 'green'),
    createSelectOption("Won't Fix", 'gray'),
  ];

  return {
    fields: [
      { type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true },
      {
        type: 'singleSelect',
        id: severityFieldId,
        name: 'Severity',
        options: {
          choices: severityOptions,
          defaultValue: 'Medium',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: statusFieldId,
        name: 'Status',
        options: {
          choices: statusOptions,
          defaultValue: 'New',
          preventAutoNewOptions: true,
        },
      },
      { type: 'singleLineText', id: environmentFieldId, name: 'Environment' },
      { type: 'longText', id: stepsFieldId, name: 'Steps to Repro' },
      {
        type: 'checkbox',
        id: reproducibleFieldId,
        name: 'Reproducible',
        options: { defaultValue: true },
      },
      { type: 'date', id: reportedAtFieldId, name: 'Reported At' },
      { type: 'user', id: ownerFieldId, name: 'Owner', options: { isMultiple: false } },
    ],
    records: [
      {
        fields: {
          [titleFieldId]: 'Login fails on retry',
          [severityFieldId]: severityOptions[2]!.id,
          [statusFieldId]: statusOptions[0]!.id,
          [environmentFieldId]: 'Production',
          [stepsFieldId]: 'Retry login twice and observe 500.',
          [reproducibleFieldId]: true,
          [reportedAtFieldId]: '2025-01-28T00:00:00.000Z',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Tooltip overlaps content',
          [severityFieldId]: severityOptions[0]!.id,
          [statusFieldId]: statusOptions[1]!.id,
          [environmentFieldId]: 'Staging',
          [stepsFieldId]: 'Hover table header for 3s.',
          [reproducibleFieldId]: true,
          [reportedAtFieldId]: '2025-01-25T00:00:00.000Z',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Export timeout',
          [severityFieldId]: severityOptions[3]!.id,
          [statusFieldId]: statusOptions[2]!.id,
          [environmentFieldId]: 'Production',
          [stepsFieldId]: 'Export 50k rows from dashboard.',
          [reproducibleFieldId]: false,
          [reportedAtFieldId]: '2025-01-22T00:00:00.000Z',
        },
      },
    ],
  };
};

export const createBugTriageFields = (): ICreateTableRequestDto['fields'] =>
  createBugTriageSeed().fields;

const createContentCalendarSeed = (): TableTemplateSeed => {
  const titleFieldId = createFieldId();
  const channelFieldId = createFieldId();
  const statusFieldId = createFieldId();
  const publishDateFieldId = createFieldId();
  const ownerFieldId = createFieldId();
  const assetUrlFieldId = createFieldId();
  const summaryFieldId = createFieldId();

  const channelOptions = [
    createSelectOption('Blog', 'purple'),
    createSelectOption('Newsletter', 'blue'),
    createSelectOption('Social', 'teal'),
    createSelectOption('Webinar', 'orange'),
  ];
  const statusOptions = [
    createSelectOption('Draft', 'gray'),
    createSelectOption('Review', 'yellow'),
    createSelectOption('Scheduled', 'blue'),
    createSelectOption('Published', 'green'),
  ];

  return {
    fields: [
      { type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true },
      {
        type: 'singleSelect',
        id: channelFieldId,
        name: 'Channel',
        options: {
          choices: channelOptions,
          defaultValue: 'Blog',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: statusFieldId,
        name: 'Status',
        options: {
          choices: statusOptions,
          defaultValue: 'Draft',
          preventAutoNewOptions: true,
        },
      },
      { type: 'date', id: publishDateFieldId, name: 'Publish Date' },
      { type: 'user', id: ownerFieldId, name: 'Owner', options: { isMultiple: false } },
      {
        type: 'singleLineText',
        id: assetUrlFieldId,
        name: 'Asset URL',
        options: { showAs: { type: 'url' } },
      },
      { type: 'longText', id: summaryFieldId, name: 'Summary' },
    ],
    records: [
      {
        fields: {
          [titleFieldId]: 'Quarterly roadmap post',
          [channelFieldId]: channelOptions[0]!.id,
          [statusFieldId]: statusOptions[1]!.id,
          [publishDateFieldId]: '2025-02-12T00:00:00.000Z',
          [assetUrlFieldId]: 'https://example.com/roadmap',
          [summaryFieldId]: 'Outline key milestones for Q2.',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Customer story',
          [channelFieldId]: channelOptions[1]!.id,
          [statusFieldId]: statusOptions[2]!.id,
          [publishDateFieldId]: '2025-02-15T00:00:00.000Z',
          [assetUrlFieldId]: 'https://example.com/case-study',
          [summaryFieldId]: 'Highlight measurable impact.',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Feature teaser',
          [channelFieldId]: channelOptions[2]!.id,
          [statusFieldId]: statusOptions[0]!.id,
          [publishDateFieldId]: '2025-02-08T00:00:00.000Z',
          [assetUrlFieldId]: 'https://example.com/teaser',
          [summaryFieldId]: 'Short video for social.',
        },
      },
    ],
  };
};

export const createContentCalendarFields = (): ICreateTableRequestDto['fields'] =>
  createContentCalendarSeed().fields;

const createProjectTrackerSeed = (): TableTemplateSeed => {
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

const createPersonalFinanceSeed = (): TableTemplateSeed => {
  const dateFieldId = createFieldId();
  const descriptionFieldId = createFieldId();
  const categoryFieldId = createFieldId();
  const typeFieldId = createFieldId();
  const amountFieldId = createFieldId();
  const accountFieldId = createFieldId();
  const clearedFieldId = createFieldId();
  const notesFieldId = createFieldId();

  const categoryOptions = [
    createSelectOption('Income', 'green'),
    createSelectOption('Housing', 'blue'),
    createSelectOption('Food', 'orange'),
    createSelectOption('Travel', 'purple'),
    createSelectOption('Utilities', 'teal'),
    createSelectOption('Other', 'gray'),
  ];
  const typeOptions = [createSelectOption('Debit', 'red'), createSelectOption('Credit', 'green')];
  const accountOptions = [
    createSelectOption('Cash', 'gray'),
    createSelectOption('Bank', 'blue'),
    createSelectOption('Card', 'purple'),
  ];

  return {
    fields: [
      { type: 'date', id: dateFieldId, name: 'Date' },
      { type: 'singleLineText', id: descriptionFieldId, name: 'Description', isPrimary: true },
      {
        type: 'singleSelect',
        id: categoryFieldId,
        name: 'Category',
        options: {
          choices: categoryOptions,
          defaultValue: 'Other',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: typeFieldId,
        name: 'Type',
        options: {
          choices: typeOptions,
          defaultValue: 'Debit',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'number',
        id: amountFieldId,
        name: 'Amount',
        options: { formatting: { type: 'currency', precision: 2, symbol: '$' } },
      },
      {
        type: 'singleSelect',
        id: accountFieldId,
        name: 'Account',
        options: {
          choices: accountOptions,
          defaultValue: 'Bank',
          preventAutoNewOptions: true,
        },
      },
      { type: 'checkbox', id: clearedFieldId, name: 'Cleared', options: { defaultValue: false } },
      { type: 'longText', id: notesFieldId, name: 'Notes' },
    ],
    records: [
      {
        fields: {
          [dateFieldId]: '2025-01-25T00:00:00.000Z',
          [descriptionFieldId]: 'Client payment',
          [categoryFieldId]: categoryOptions[0]!.id,
          [typeFieldId]: typeOptions[1]!.id,
          [amountFieldId]: 4200,
          [accountFieldId]: accountOptions[1]!.id,
          [clearedFieldId]: true,
          [notesFieldId]: 'Invoice #3201',
        },
      },
      {
        fields: {
          [dateFieldId]: '2025-01-26T00:00:00.000Z',
          [descriptionFieldId]: 'Office rent',
          [categoryFieldId]: categoryOptions[1]!.id,
          [typeFieldId]: typeOptions[0]!.id,
          [amountFieldId]: 1800,
          [accountFieldId]: accountOptions[1]!.id,
          [clearedFieldId]: true,
          [notesFieldId]: 'February payment',
        },
      },
      {
        fields: {
          [dateFieldId]: '2025-01-27T00:00:00.000Z',
          [descriptionFieldId]: 'Team lunch',
          [categoryFieldId]: categoryOptions[2]!.id,
          [typeFieldId]: typeOptions[0]!.id,
          [amountFieldId]: 96,
          [accountFieldId]: accountOptions[2]!.id,
          [clearedFieldId]: false,
          [notesFieldId]: 'New restaurant',
        },
      },
      {
        fields: {
          [dateFieldId]: '2025-01-28T00:00:00.000Z',
          [descriptionFieldId]: 'Cloud hosting',
          [categoryFieldId]: categoryOptions[4]!.id,
          [typeFieldId]: typeOptions[0]!.id,
          [amountFieldId]: 320,
          [accountFieldId]: accountOptions[1]!.id,
          [clearedFieldId]: false,
          [notesFieldId]: 'January usage',
        },
      },
    ],
  };
};

export const createPersonalFinanceFields = (): ICreateTableRequestDto['fields'] =>
  createPersonalFinanceSeed().fields;

export const createAllFieldTypesFields = (): ICreateTableRequestDto['fields'] => {
  const amountFieldId = createFieldId();
  const scoreFieldId = createFieldId();
  const scoreLabelFieldId = createFieldId();

  return [
    {
      type: 'singleLineText',
      name: 'Name',
      notNull: true,
      unique: true,
      options: { showAs: { type: 'email' }, defaultValue: 'owner@example.com' },
    },
    {
      type: 'longText',
      name: 'Description',
      notNull: true,
      unique: true,
      options: { defaultValue: 'Details' },
    },
    {
      type: 'number',
      id: amountFieldId,
      name: 'Amount',
      notNull: true,
      unique: true,
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
      notNull: true,
      options: { max: 5, icon: 'star', color: 'yellowBright' },
    },
    {
      type: 'singleSelect',
      name: 'Status',
      notNull: true,
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
      notNull: true,
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
    { type: 'attachment', name: 'Files', notNull: true },
    {
      type: 'date',
      name: 'Due Date',
      notNull: true,
      unique: true,
      options: {
        formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
        defaultValue: 'now',
      },
    },
    {
      type: 'user',
      name: 'Owner',
      notNull: true,
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

const createAllFieldTypesSeed = (): TableTemplateSeed => ({
  fields: createAllFieldTypesFields(),
});

export const createTextColumns = (count: number): ICreateTableRequestDto['fields'] =>
  Array.from({ length: count }, (_, index) => ({
    type: 'singleLineText',
    name: `Column ${index + 1}`,
  }));

export const simpleTableTemplate = createTemplate(
  'simple-3',
  'Simple 3 Columns',
  'Single line text, number, and checkbox fields.',
  createSimpleSeed,
  3
);

export const allBaseFieldsTemplate = createTemplate(
  'all-base-fields',
  'All Base Fields',
  'Common field types without formulas.',
  createAllBaseFieldsSeed,
  3
);

export const todoTemplate = createTemplate(
  'todo',
  'Todo List',
  'Simple tasks with status, priority, and due dates.',
  createTodoSeed,
  4
);

export const bugTriageTemplate = createTemplate(
  'bug-triage',
  'Bug Triage',
  'Track bugs with severity, status, and ownership.',
  createBugTriageSeed,
  3
);

export const contentCalendarTemplate = createTemplate(
  'content-calendar',
  'Content Calendar',
  'Plan content with channels, status, and publish dates.',
  createContentCalendarSeed,
  3
);

export const projectTrackerTemplate = createTemplate(
  'project-tracker',
  'Project Tracker',
  'Track work items with status, progress, and budget.',
  createProjectTrackerSeed,
  3
);

export const personalFinanceTemplate = createTemplate(
  'personal-finance',
  'Personal Finance',
  'Log transactions with categories, amounts, and accounts.',
  createPersonalFinanceSeed,
  4
);

export const allFieldTypesTemplate = createTemplate(
  'all-field-types',
  'All Field Types',
  'Every field type with richer options and formulas.',
  createAllFieldTypesSeed
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
