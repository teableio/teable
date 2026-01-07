/* eslint-disable sonarjs/no-duplicate-string */
import type { ICreateTableRequestDto, ICreateTablesRequestDto } from '@teable/v2-contract-http';
import { FieldId, RecordId, SelectOptionId, TableId, type FieldColorValue } from '@teable/v2-core';

export type TableTemplateDefinition = {
  key: string;
  name: string;
  description: string;
  defaultRecordCount?: number;
  tables: ReadonlyArray<TableTemplateTablePreview>;
  createInput: (
    baseId: string,
    options?: CreateTableTemplateInputOptions
  ) => ICreateTablesRequestDto;
};

export type TableTemplateTablePreview = {
  key: string;
  name: string;
  description?: string;
  fieldCount: number;
  defaultRecordCount: number;
};

export type CreateTableTemplateInputOptions = {
  includeRecords?: boolean;
  /**
   * If provided:
   * - single-table templates: uses this as the table name
   * - multi-table templates: prefixes table names as `${namePrefix} - ${tableName}`
   */
  namePrefix?: string;
};

type SingleTableSeed = {
  fields: NonNullable<ICreateTableRequestDto['fields']>;
  records?: ICreateTableRequestDto['records'];
  defaultRecordCount?: number;
};

type TemplateTableSeed = {
  key: string;
  name: string;
  description?: string;
  tableId?: string;
  fields: NonNullable<ICreateTableRequestDto['fields']>;
  records?: ICreateTableRequestDto['records'];
  defaultRecordCount?: number;
};

type TemplateSeed = {
  tables: ReadonlyArray<TemplateTableSeed>;
};

type TemplateRecord = NonNullable<ICreateTableRequestDto['records']>[number];

const MIN_TEMPLATE_RECORDS = 5;
const MAX_TEMPLATE_RECORDS = 100;

const createTemplate = (
  key: string,
  name: string,
  description: string,
  buildSeed: () => TemplateSeed,
  defaultRecordCount?: number
): TableTemplateDefinition => ({
  ...(() => {
    const previewSeed = buildSeed();
    const previewTables: TableTemplateTablePreview[] = previewSeed.tables.map((table) => ({
      key: table.key,
      name: table.name,
      description: table.description,
      fieldCount: table.fields.length,
      defaultRecordCount: resolveTemplateRecordCount(table.records, table.defaultRecordCount),
    }));

    const totalSeedRecords = previewTables.reduce(
      (sum, table) => sum + table.defaultRecordCount,
      0
    );

    return {
      key,
      name,
      description,
      defaultRecordCount: defaultRecordCount ?? totalSeedRecords,
      tables: previewTables,
      createInput: (baseId: string, options?: CreateTableTemplateInputOptions) => {
        const seed = buildSeed();
        const includeRecords = options?.includeRecords ?? false;
        const namePrefix = options?.namePrefix?.trim();
        const isMultiTable = seed.tables.length > 1;

        return {
          baseId,
          tables: seed.tables.map((table) => {
            const seedRecords = table.records;
            const canIncludeRecords = Boolean(seedRecords && seedRecords.length > 0);
            const recordCount = resolveTemplateRecordCount(seedRecords, table.defaultRecordCount);
            const records =
              includeRecords && canIncludeRecords && recordCount > 0
                ? [...normalizeTemplateRecords(seedRecords ?? [], recordCount)]
                : undefined;
            const resolvedName = (() => {
              if (!namePrefix) return table.name;
              if (!isMultiTable) return namePrefix;
              return `${namePrefix} - ${table.name}`;
            })();

            return {
              ...(table.tableId ? { tableId: table.tableId } : {}),
              name: resolvedName,
              fields: table.fields,
              ...(records ? { records } : {}),
            };
          }),
        };
      },
    };
  })(),
});

const createFieldId = (): string => FieldId.mustGenerate().toString();
const createRecordId = (): string => {
  const idResult = RecordId.generate();
  if (idResult.isOk()) return idResult.value.toString();
  const fallback = Math.random().toString(36).slice(2).padEnd(16, '0').slice(0, 16);
  return `rec${fallback}`;
};
const createTableId = (): string => {
  const idResult = TableId.generate();
  if (idResult.isOk()) return idResult.value.toString();
  const fallback = Math.random().toString(36).slice(2).padEnd(16, '0').slice(0, 16);
  return `tbl${fallback}`;
};
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
  if (records.length === 0) {
    return Array.from({ length: recordCount }, () => ({ fields: {} }));
  }
  const extraRecords = Array.from({ length: missing }, (_, index) => {
    const record = records[index % records.length];
    const { fields } = record;
    return { fields: { ...fields } };
  });
  return [...records, ...extraRecords];
};

const resolveTemplateRecordCount = (
  records?: ReadonlyArray<TemplateRecord>,
  defaultRecordCount?: number
): number => {
  if (!records || records.length === 0) return 0;
  const desiredCount = defaultRecordCount ?? records.length;
  return Math.min(MAX_TEMPLATE_RECORDS, Math.max(MIN_TEMPLATE_RECORDS, desiredCount));
};

const singleTable = (
  key: string,
  name: string,
  description: string,
  buildSeed: () => SingleTableSeed,
  defaultRecordCount?: number
): TableTemplateDefinition =>
  createTemplate(
    key,
    name,
    description,
    () => ({
      tables: (() => {
        const seed = buildSeed();
        return [
          {
            key: 'main',
            name,
            description,
            fields: seed.fields,
            records: seed.records,
            defaultRecordCount: seed.defaultRecordCount,
          },
        ];
      })(),
    }),
    defaultRecordCount
  );

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

const createBugTriageSeed = (): SingleTableSeed => {
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

const createContentCalendarSeed = (): SingleTableSeed => {
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
    defaultRecordCount: 60,
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

const createPersonalFinanceSeed = (): SingleTableSeed => {
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
    defaultRecordCount: 40,
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

const createBugTriageTemplateSeed = (): TemplateSeed => {
  const componentsTableId = createTableId();
  const componentNameFieldId = createFieldId();
  const authComponentRecordId = createRecordId();
  const uiComponentRecordId = createRecordId();
  const exportComponentRecordId = createRecordId();

  const componentsTable: TemplateTableSeed = {
    key: 'components',
    name: 'Components',
    description: 'Product areas your bugs belong to.',
    tableId: componentsTableId,
    fields: [{ type: 'singleLineText', id: componentNameFieldId, name: 'Name', isPrimary: true }],
    defaultRecordCount: 12,
    records: [
      { id: authComponentRecordId, fields: { [componentNameFieldId]: 'Auth' } },
      { id: uiComponentRecordId, fields: { [componentNameFieldId]: 'UI' } },
      { id: exportComponentRecordId, fields: { [componentNameFieldId]: 'Export' } },
    ],
  };

  const bugsTableId = createTableId();
  const titleFieldId = createFieldId();
  const severityFieldId = createFieldId();
  const statusFieldId = createFieldId();
  const environmentFieldId = createFieldId();
  const stepsFieldId = createFieldId();
  const reproducibleFieldId = createFieldId();
  const reportedAtFieldId = createFieldId();
  const componentLinkFieldId = createFieldId();
  const componentLookupFieldId = createFieldId();
  const componentConditionalLookupFieldId = createFieldId();
  const componentConditionalRollupFieldId = createFieldId();

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

  const bugsTable: TemplateTableSeed = {
    key: 'bugs',
    name: 'Bugs',
    description: 'Track bugs with severity, status, and components.',
    tableId: bugsTableId,
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
      {
        type: 'link',
        id: componentLinkFieldId,
        name: 'Component',
        options: {
          relationship: 'manyOne',
          foreignTableId: componentsTableId,
          lookupFieldId: componentNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: componentLookupFieldId,
        name: 'Component Name',
        options: {
          linkFieldId: componentLinkFieldId,
          foreignTableId: componentsTableId,
          lookupFieldId: componentNameFieldId,
        },
      },
      {
        type: 'conditionalLookup',
        id: componentConditionalLookupFieldId,
        name: 'UI Components',
        options: {
          foreignTableId: componentsTableId,
          lookupFieldId: componentNameFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: componentNameFieldId,
                  operator: 'is',
                  value: 'UI',
                },
              ],
            },
          },
        },
      },
      {
        type: 'conditionalRollup',
        id: componentConditionalRollupFieldId,
        name: 'UI Component Count',
        options: {
          expression: 'count({values})',
        },
        config: {
          foreignTableId: componentsTableId,
          lookupFieldId: componentNameFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: componentNameFieldId,
                  operator: 'is',
                  value: 'UI',
                },
              ],
            },
          },
        },
      },
    ],
    defaultRecordCount: 100,
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
          [componentLinkFieldId]: { id: authComponentRecordId },
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
          [componentLinkFieldId]: { id: uiComponentRecordId },
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
          [componentLinkFieldId]: { id: exportComponentRecordId },
        },
      },
    ],
  };

  return { tables: [bugsTable, componentsTable] };
};

const createCrmHubspotTemplateSeed = (): TemplateSeed => {
  const companiesTableId = createTableId();
  const contactsTableId = createTableId();
  const dealsTableId = createTableId();
  const ticketsTableId = createTableId();
  const activitiesTableId = createTableId();

  const companyNameFieldId = createFieldId();
  const companyDomainFieldId = createFieldId();
  const companyWebsiteFieldId = createFieldId();
  const industryFieldId = createFieldId();
  const accountTierFieldId = createFieldId();
  const accountStatusFieldId = createFieldId();
  const lifecycleStageFieldId = createFieldId();
  const regionFieldId = createFieldId();
  const companyRevenueFieldId = createFieldId();
  const companyEmployeeCountFieldId = createFieldId();
  const companyPhoneFieldId = createFieldId();
  const companyCityFieldId = createFieldId();
  const companyCountryFieldId = createFieldId();
  const companyOwnerFieldId = createFieldId();
  const companyNotesFieldId = createFieldId();
  const companyCreatedAtFieldId = createFieldId();

  const industryOptions = [
    createSelectOption('SaaS', 'blue'),
    createSelectOption('E-commerce', 'purple'),
    createSelectOption('Fintech', 'teal'),
    createSelectOption('Healthcare', 'orange'),
  ];
  const tierOptions = [
    createSelectOption('Enterprise', 'red'),
    createSelectOption('Mid-Market', 'yellow'),
    createSelectOption('SMB', 'green'),
  ];
  const accountStatusOptions = [
    createSelectOption('Prospect', 'blue'),
    createSelectOption('Customer', 'green'),
    createSelectOption('Churned', 'red'),
  ];
  const lifecycleStageOptions = [
    createSelectOption('Subscriber', 'blue'),
    createSelectOption('Lead', 'yellow'),
    createSelectOption('MQL', 'orange'),
    createSelectOption('SQL', 'purple'),
    createSelectOption('Opportunity', 'teal'),
    createSelectOption('Customer', 'green'),
    createSelectOption('Evangelist', 'blue'),
  ];
  const regionOptions = [
    createSelectOption('North America', 'teal'),
    createSelectOption('EMEA', 'purple'),
    createSelectOption('APAC', 'orange'),
  ];

  const acmeCompanyRecordId = createRecordId();
  const northwindCompanyRecordId = createRecordId();
  const adaContactRecordId = createRecordId();
  const graceContactRecordId = createRecordId();
  const acmeDealRecordId = createRecordId();
  const northwindDealRecordId = createRecordId();

  const companiesTable: TemplateTableSeed = {
    key: 'companies',
    name: 'Companies',
    description: 'Accounts you sell to.',
    tableId: companiesTableId,
    fields: [
      { type: 'singleLineText', id: companyNameFieldId, name: 'Name', isPrimary: true },
      { type: 'singleLineText', id: companyDomainFieldId, name: 'Domain' },
      {
        type: 'singleLineText',
        id: companyWebsiteFieldId,
        name: 'Website',
        options: { showAs: { type: 'url' } },
      },
      {
        type: 'singleSelect',
        id: industryFieldId,
        name: 'Industry',
        options: {
          choices: industryOptions,
          defaultValue: 'SaaS',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: accountTierFieldId,
        name: 'Account Tier',
        options: {
          choices: tierOptions,
          defaultValue: 'Mid-Market',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: accountStatusFieldId,
        name: 'Account Status',
        options: {
          choices: accountStatusOptions,
          defaultValue: 'Prospect',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: lifecycleStageFieldId,
        name: 'Lifecycle Stage',
        options: {
          choices: lifecycleStageOptions,
          defaultValue: 'Lead',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: regionFieldId,
        name: 'Region',
        options: {
          choices: regionOptions,
          defaultValue: 'North America',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'number',
        id: companyRevenueFieldId,
        name: 'Annual Revenue',
        options: { formatting: { type: 'currency', precision: 0, symbol: '$' } },
      },
      { type: 'number', id: companyEmployeeCountFieldId, name: 'Employee Count' },
      { type: 'singleLineText', id: companyPhoneFieldId, name: 'Phone' },
      { type: 'singleLineText', id: companyCityFieldId, name: 'City' },
      { type: 'singleLineText', id: companyCountryFieldId, name: 'Country' },
      { type: 'user', id: companyOwnerFieldId, name: 'Owner', options: { isMultiple: false } },
      { type: 'longText', id: companyNotesFieldId, name: 'Notes' },
      { type: 'date', id: companyCreatedAtFieldId, name: 'Created At' },
    ],
    defaultRecordCount: 30,
    records: [
      {
        id: acmeCompanyRecordId,
        fields: {
          [companyNameFieldId]: 'Acme Inc.',
          [companyWebsiteFieldId]: 'https://acme.example',
          [companyDomainFieldId]: 'acme.example',
          [industryFieldId]: industryOptions[0]!.id,
          [accountTierFieldId]: tierOptions[1]!.id,
          [accountStatusFieldId]: accountStatusOptions[0]!.id,
          [lifecycleStageFieldId]: lifecycleStageOptions[2]!.id,
          [regionFieldId]: regionOptions[0]!.id,
          [companyRevenueFieldId]: 1200000,
          [companyEmployeeCountFieldId]: 420,
          [companyPhoneFieldId]: '+1-555-0183',
          [companyCityFieldId]: 'San Francisco',
          [companyCountryFieldId]: 'USA',
          [companyCreatedAtFieldId]: '2025-01-10T00:00:00.000Z',
        },
      },
      {
        id: northwindCompanyRecordId,
        fields: {
          [companyNameFieldId]: 'Northwind Traders',
          [companyWebsiteFieldId]: 'https://northwind.example',
          [companyDomainFieldId]: 'northwind.example',
          [industryFieldId]: industryOptions[1]!.id,
          [accountTierFieldId]: tierOptions[2]!.id,
          [accountStatusFieldId]: accountStatusOptions[1]!.id,
          [lifecycleStageFieldId]: lifecycleStageOptions[5]!.id,
          [regionFieldId]: regionOptions[1]!.id,
          [companyRevenueFieldId]: 450000,
          [companyEmployeeCountFieldId]: 120,
          [companyPhoneFieldId]: '+44-20-7946-0958',
          [companyCityFieldId]: 'London',
          [companyCountryFieldId]: 'UK',
          [companyCreatedAtFieldId]: '2024-12-01T00:00:00.000Z',
        },
      },
    ],
  };

  const contactNameFieldId = createFieldId();
  const contactTitleFieldId = createFieldId();
  const contactEmailFieldId = createFieldId();
  const contactPhoneFieldId = createFieldId();
  const contactCompanyLinkFieldId = createFieldId();
  const contactCompanyLookupFieldId = createFieldId();
  const leadStatusFieldId = createFieldId();
  const contactLifecycleStageFieldId = createFieldId();
  const lastContactedFieldId = createFieldId();
  const contactNotesFieldId = createFieldId();

  const leadStatusOptions = [
    createSelectOption('New', 'blue'),
    createSelectOption('Open', 'yellow'),
    createSelectOption('In Progress', 'purple'),
    createSelectOption('Open Deal', 'teal'),
    createSelectOption('Unqualified', 'red'),
  ];
  const contactLifecycleStageOptions = [
    createSelectOption('Subscriber', 'blue'),
    createSelectOption('Lead', 'yellow'),
    createSelectOption('MQL', 'orange'),
    createSelectOption('SQL', 'purple'),
    createSelectOption('Opportunity', 'teal'),
    createSelectOption('Customer', 'green'),
  ];

  const contactsTable: TemplateTableSeed = {
    key: 'contacts',
    name: 'Contacts',
    description: 'People at your accounts.',
    tableId: contactsTableId,
    fields: [
      { type: 'singleLineText', id: contactNameFieldId, name: 'Name', isPrimary: true },
      { type: 'singleLineText', id: contactTitleFieldId, name: 'Title' },
      {
        type: 'singleLineText',
        id: contactEmailFieldId,
        name: 'Email',
        options: { showAs: { type: 'email' } },
      },
      { type: 'singleLineText', id: contactPhoneFieldId, name: 'Phone' },
      {
        type: 'link',
        id: contactCompanyLinkFieldId,
        name: 'Company',
        options: {
          relationship: 'manyOne',
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: contactCompanyLookupFieldId,
        name: 'Company Name',
        options: {
          linkFieldId: contactCompanyLinkFieldId,
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'singleSelect',
        id: leadStatusFieldId,
        name: 'Lead Status',
        options: {
          choices: leadStatusOptions,
          defaultValue: 'New',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: contactLifecycleStageFieldId,
        name: 'Lifecycle Stage',
        options: {
          choices: contactLifecycleStageOptions,
          defaultValue: 'Lead',
          preventAutoNewOptions: true,
        },
      },
      { type: 'date', id: lastContactedFieldId, name: 'Last Contacted' },
      { type: 'longText', id: contactNotesFieldId, name: 'Notes' },
    ],
    defaultRecordCount: 80,
    records: [
      {
        id: adaContactRecordId,
        fields: {
          [contactNameFieldId]: 'Ada Lovelace',
          [contactTitleFieldId]: 'Head of Data',
          [contactEmailFieldId]: 'ada@acme.example',
          [contactCompanyLinkFieldId]: { id: acmeCompanyRecordId },
          [leadStatusFieldId]: leadStatusOptions[2]!.id,
          [contactLifecycleStageFieldId]: contactLifecycleStageOptions[2]!.id,
          [lastContactedFieldId]: '2025-02-02T00:00:00.000Z',
        },
      },
      {
        id: graceContactRecordId,
        fields: {
          [contactNameFieldId]: 'Grace Hopper',
          [contactTitleFieldId]: 'VP Engineering',
          [contactEmailFieldId]: 'grace@northwind.example',
          [contactCompanyLinkFieldId]: { id: northwindCompanyRecordId },
          [leadStatusFieldId]: leadStatusOptions[3]!.id,
          [contactLifecycleStageFieldId]: contactLifecycleStageOptions[5]!.id,
          [lastContactedFieldId]: '2025-01-20T00:00:00.000Z',
        },
      },
    ],
  };

  const dealNameFieldId = createFieldId();
  const dealCompanyLinkFieldId = createFieldId();
  const dealCompanyLookupFieldId = createFieldId();
  const dealPrimaryContactLinkFieldId = createFieldId();
  const dealAmountFieldId = createFieldId();
  const dealPipelineFieldId = createFieldId();
  const dealStageFieldId = createFieldId();
  const dealProbabilityFieldId = createFieldId();
  const dealExpectedValueFieldId = createFieldId();
  const dealCloseDateFieldId = createFieldId();
  const dealOwnerFieldId = createFieldId();
  const dealNextStepFieldId = createFieldId();
  const dealForecastCategoryFieldId = createFieldId();

  const dealStageOptions = [
    createSelectOption('Prospecting', 'blue'),
    createSelectOption('Qualification', 'yellow'),
    createSelectOption('Proposal', 'purple'),
    createSelectOption('Negotiation', 'orange'),
    createSelectOption('Closed Won', 'green'),
    createSelectOption('Closed Lost', 'red'),
  ];
  const pipelineOptions = [
    createSelectOption('Sales Pipeline', 'blue'),
    createSelectOption('Renewals', 'purple'),
  ];
  const forecastCategoryOptions = [
    createSelectOption('Pipeline', 'blue'),
    createSelectOption('Best Case', 'yellow'),
    createSelectOption('Commit', 'green'),
    createSelectOption('Omitted', 'red'),
  ];

  const dealsTable: TemplateTableSeed = {
    key: 'deals',
    name: 'Deals',
    description: 'Active opportunities and pipeline.',
    tableId: dealsTableId,
    fields: [
      { type: 'singleLineText', id: dealNameFieldId, name: 'Name', isPrimary: true },
      {
        type: 'link',
        id: dealCompanyLinkFieldId,
        name: 'Company',
        options: {
          relationship: 'manyOne',
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: dealCompanyLookupFieldId,
        name: 'Company Name',
        options: {
          linkFieldId: dealCompanyLinkFieldId,
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'link',
        id: dealPrimaryContactLinkFieldId,
        name: 'Primary Contact',
        options: {
          relationship: 'manyOne',
          foreignTableId: contactsTableId,
          lookupFieldId: contactNameFieldId,
        },
      },
      {
        type: 'number',
        id: dealAmountFieldId,
        name: 'Amount',
        options: { formatting: { type: 'currency', precision: 0, symbol: '$' } },
      },
      {
        type: 'singleSelect',
        id: dealPipelineFieldId,
        name: 'Pipeline',
        options: {
          choices: pipelineOptions,
          defaultValue: 'Sales Pipeline',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: dealStageFieldId,
        name: 'Stage',
        options: {
          choices: dealStageOptions,
          defaultValue: 'Prospecting',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'number',
        id: dealProbabilityFieldId,
        name: 'Probability',
        options: { formatting: { type: 'decimal', precision: 0 } },
      },
      {
        type: 'formula',
        id: dealExpectedValueFieldId,
        name: 'Expected Value',
        options: {
          expression: `{${dealAmountFieldId}} * {${dealProbabilityFieldId}} / 100`,
          formatting: { type: 'currency', precision: 0, symbol: '$' },
        },
      },
      { type: 'date', id: dealCloseDateFieldId, name: 'Close Date' },
      { type: 'user', id: dealOwnerFieldId, name: 'Owner', options: { isMultiple: false } },
      { type: 'singleLineText', id: dealNextStepFieldId, name: 'Next Step' },
      {
        type: 'singleSelect',
        id: dealForecastCategoryFieldId,
        name: 'Forecast Category',
        options: {
          choices: forecastCategoryOptions,
          defaultValue: 'Pipeline',
          preventAutoNewOptions: true,
        },
      },
    ],
    defaultRecordCount: 60,
    records: [
      {
        id: acmeDealRecordId,
        fields: {
          [dealNameFieldId]: 'Acme Expansion',
          [dealCompanyLinkFieldId]: { id: acmeCompanyRecordId },
          [dealPrimaryContactLinkFieldId]: { id: adaContactRecordId },
          [dealAmountFieldId]: 240000,
          [dealPipelineFieldId]: pipelineOptions[0]!.id,
          [dealStageFieldId]: dealStageOptions[2]!.id,
          [dealProbabilityFieldId]: 40,
          [dealCloseDateFieldId]: '2025-03-15T00:00:00.000Z',
          [dealForecastCategoryFieldId]: forecastCategoryOptions[0]!.id,
          [dealNextStepFieldId]: 'Schedule security review',
        },
      },
      {
        id: northwindDealRecordId,
        fields: {
          [dealNameFieldId]: 'Northwind Renewal',
          [dealCompanyLinkFieldId]: { id: northwindCompanyRecordId },
          [dealPrimaryContactLinkFieldId]: { id: graceContactRecordId },
          [dealAmountFieldId]: 90000,
          [dealPipelineFieldId]: pipelineOptions[1]!.id,
          [dealStageFieldId]: dealStageOptions[4]!.id,
          [dealProbabilityFieldId]: 85,
          [dealCloseDateFieldId]: '2025-02-28T00:00:00.000Z',
          [dealForecastCategoryFieldId]: forecastCategoryOptions[2]!.id,
          [dealNextStepFieldId]: 'Send final order form',
        },
      },
    ],
  };

  const activitySubjectFieldId = createFieldId();
  const activityTypeFieldId = createFieldId();
  const activityStatusFieldId = createFieldId();
  const activityDueDateFieldId = createFieldId();
  const activityCompanyLinkFieldId = createFieldId();
  const activityCompanyLookupFieldId = createFieldId();
  const activityContactLinkFieldId = createFieldId();
  const activityContactLookupFieldId = createFieldId();
  const activityDealLinkFieldId = createFieldId();
  const activityDealLookupFieldId = createFieldId();
  const activityNotesFieldId = createFieldId();
  const activityOwnerFieldId = createFieldId();

  const activityTypeOptions = [
    createSelectOption('Call', 'blue'),
    createSelectOption('Email', 'purple'),
    createSelectOption('Meeting', 'green'),
    createSelectOption('Task', 'orange'),
  ];
  const activityStatusOptions = [
    createSelectOption('Planned', 'yellow'),
    createSelectOption('Completed', 'green'),
  ];

  const activitiesTable: TemplateTableSeed = {
    key: 'activities',
    name: 'Activities',
    description: 'Calls, meetings, and tasks tied to pipeline.',
    tableId: activitiesTableId,
    fields: [
      { type: 'singleLineText', id: activitySubjectFieldId, name: 'Subject', isPrimary: true },
      {
        type: 'singleSelect',
        id: activityTypeFieldId,
        name: 'Type',
        options: {
          choices: activityTypeOptions,
          defaultValue: 'Call',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: activityStatusFieldId,
        name: 'Status',
        options: {
          choices: activityStatusOptions,
          defaultValue: 'Planned',
          preventAutoNewOptions: true,
        },
      },
      { type: 'date', id: activityDueDateFieldId, name: 'Due Date' },
      {
        type: 'link',
        id: activityCompanyLinkFieldId,
        name: 'Company',
        options: {
          relationship: 'manyOne',
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: activityCompanyLookupFieldId,
        name: 'Company Name',
        options: {
          linkFieldId: activityCompanyLinkFieldId,
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'link',
        id: activityContactLinkFieldId,
        name: 'Contact',
        options: {
          relationship: 'manyOne',
          foreignTableId: contactsTableId,
          lookupFieldId: contactNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: activityContactLookupFieldId,
        name: 'Contact Name',
        options: {
          linkFieldId: activityContactLinkFieldId,
          foreignTableId: contactsTableId,
          lookupFieldId: contactNameFieldId,
        },
      },
      {
        type: 'link',
        id: activityDealLinkFieldId,
        name: 'Deal',
        options: {
          relationship: 'manyOne',
          foreignTableId: dealsTableId,
          lookupFieldId: dealNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: activityDealLookupFieldId,
        name: 'Deal Name',
        options: {
          linkFieldId: activityDealLinkFieldId,
          foreignTableId: dealsTableId,
          lookupFieldId: dealNameFieldId,
        },
      },
      { type: 'longText', id: activityNotesFieldId, name: 'Notes' },
      { type: 'user', id: activityOwnerFieldId, name: 'Owner', options: { isMultiple: false } },
    ],
    defaultRecordCount: 100,
    records: [
      {
        fields: {
          [activitySubjectFieldId]: 'Discovery call with Acme',
          [activityTypeFieldId]: activityTypeOptions[0]!.id,
          [activityStatusFieldId]: activityStatusOptions[1]!.id,
          [activityDueDateFieldId]: '2025-02-01T00:00:00.000Z',
          [activityCompanyLinkFieldId]: { id: acmeCompanyRecordId },
          [activityContactLinkFieldId]: { id: adaContactRecordId },
          [activityDealLinkFieldId]: { id: acmeDealRecordId },
        },
      },
      {
        fields: {
          [activitySubjectFieldId]: 'Send renewal proposal',
          [activityTypeFieldId]: activityTypeOptions[3]!.id,
          [activityStatusFieldId]: activityStatusOptions[0]!.id,
          [activityDueDateFieldId]: '2025-02-10T00:00:00.000Z',
          [activityCompanyLinkFieldId]: { id: northwindCompanyRecordId },
          [activityContactLinkFieldId]: { id: graceContactRecordId },
          [activityDealLinkFieldId]: { id: northwindDealRecordId },
        },
      },
    ],
  };

  const ticketNameFieldId = createFieldId();
  const ticketCompanyLinkFieldId = createFieldId();
  const ticketCompanyLookupFieldId = createFieldId();
  const ticketContactLinkFieldId = createFieldId();
  const ticketContactLookupFieldId = createFieldId();
  const ticketPipelineFieldId = createFieldId();
  const ticketStatusFieldId = createFieldId();
  const ticketPriorityFieldId = createFieldId();
  const ticketOwnerFieldId = createFieldId();
  const ticketCreatedAtFieldId = createFieldId();
  const ticketClosedAtFieldId = createFieldId();
  const ticketNotesFieldId = createFieldId();

  const ticketPipelineOptions = [
    createSelectOption('Support Pipeline', 'blue'),
    createSelectOption('Onboarding', 'green'),
  ];
  const ticketStatusOptions = [
    createSelectOption('New', 'blue'),
    createSelectOption('Waiting on Contact', 'yellow'),
    createSelectOption('Waiting on Us', 'purple'),
    createSelectOption('Closed', 'green'),
  ];
  const ticketPriorityOptions = [
    createSelectOption('Low', 'green'),
    createSelectOption('Medium', 'yellow'),
    createSelectOption('High', 'red'),
  ];

  const ticketsTable: TemplateTableSeed = {
    key: 'tickets',
    name: 'Tickets',
    description: 'Support and onboarding tickets.',
    tableId: ticketsTableId,
    fields: [
      { type: 'singleLineText', id: ticketNameFieldId, name: 'Name', isPrimary: true },
      {
        type: 'link',
        id: ticketCompanyLinkFieldId,
        name: 'Company',
        options: {
          relationship: 'manyOne',
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: ticketCompanyLookupFieldId,
        name: 'Company Name',
        options: {
          linkFieldId: ticketCompanyLinkFieldId,
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'link',
        id: ticketContactLinkFieldId,
        name: 'Contact',
        options: {
          relationship: 'manyOne',
          foreignTableId: contactsTableId,
          lookupFieldId: contactNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: ticketContactLookupFieldId,
        name: 'Contact Name',
        options: {
          linkFieldId: ticketContactLinkFieldId,
          foreignTableId: contactsTableId,
          lookupFieldId: contactNameFieldId,
        },
      },
      {
        type: 'singleSelect',
        id: ticketPipelineFieldId,
        name: 'Pipeline',
        options: {
          choices: ticketPipelineOptions,
          defaultValue: 'Support Pipeline',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: ticketStatusFieldId,
        name: 'Status',
        options: {
          choices: ticketStatusOptions,
          defaultValue: 'New',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: ticketPriorityFieldId,
        name: 'Priority',
        options: {
          choices: ticketPriorityOptions,
          defaultValue: 'Medium',
          preventAutoNewOptions: true,
        },
      },
      { type: 'user', id: ticketOwnerFieldId, name: 'Owner', options: { isMultiple: false } },
      { type: 'date', id: ticketCreatedAtFieldId, name: 'Created At' },
      { type: 'date', id: ticketClosedAtFieldId, name: 'Closed At' },
      { type: 'longText', id: ticketNotesFieldId, name: 'Notes' },
    ],
    defaultRecordCount: 40,
    records: [
      {
        fields: {
          [ticketNameFieldId]: 'Onboarding: import legacy data',
          [ticketCompanyLinkFieldId]: { id: acmeCompanyRecordId },
          [ticketContactLinkFieldId]: { id: adaContactRecordId },
          [ticketPipelineFieldId]: ticketPipelineOptions[1]!.id,
          [ticketStatusFieldId]: ticketStatusOptions[1]!.id,
          [ticketPriorityFieldId]: ticketPriorityOptions[1]!.id,
          [ticketCreatedAtFieldId]: '2025-01-12T00:00:00.000Z',
        },
      },
      {
        fields: {
          [ticketNameFieldId]: 'Support: SSO setup',
          [ticketCompanyLinkFieldId]: { id: northwindCompanyRecordId },
          [ticketContactLinkFieldId]: { id: graceContactRecordId },
          [ticketPipelineFieldId]: ticketPipelineOptions[0]!.id,
          [ticketStatusFieldId]: ticketStatusOptions[2]!.id,
          [ticketPriorityFieldId]: ticketPriorityOptions[2]!.id,
          [ticketCreatedAtFieldId]: '2025-01-28T00:00:00.000Z',
        },
      },
    ],
  };

  return { tables: [companiesTable, contactsTable, dealsTable, ticketsTable, activitiesTable] };
};

const createHrManagementTemplateSeed = (): TemplateSeed => {
  const departmentsTableId = createTableId();
  const positionsTableId = createTableId();
  const employeesTableId = createTableId();
  const applicationsTableId = createTableId();
  const timeOffTableId = createTableId();
  const reviewsTableId = createTableId();

  const departmentNameFieldId = createFieldId();
  const departmentLeadFieldId = createFieldId();
  const departmentBudgetFieldId = createFieldId();
  const departmentLocationFieldId = createFieldId();
  const departmentHeadcountFieldId = createFieldId();
  const engineeringDepartmentRecordId = createRecordId();
  const peopleOpsDepartmentRecordId = createRecordId();

  const departmentsTable: TemplateTableSeed = {
    key: 'departments',
    name: 'Departments',
    description: 'Business units and owners.',
    tableId: departmentsTableId,
    fields: [
      { type: 'singleLineText', id: departmentNameFieldId, name: 'Name', isPrimary: true },
      { type: 'user', id: departmentLeadFieldId, name: 'Lead', options: { isMultiple: false } },
      {
        type: 'number',
        id: departmentBudgetFieldId,
        name: 'Budget',
        options: { formatting: { type: 'currency', precision: 0, symbol: '$' } },
      },
      { type: 'singleLineText', id: departmentLocationFieldId, name: 'Location' },
      { type: 'number', id: departmentHeadcountFieldId, name: 'Headcount' },
    ],
    defaultRecordCount: 8,
    records: [
      {
        id: engineeringDepartmentRecordId,
        fields: {
          [departmentNameFieldId]: 'Engineering',
          [departmentBudgetFieldId]: 1200000,
          [departmentLocationFieldId]: 'San Francisco',
        },
      },
      {
        id: peopleOpsDepartmentRecordId,
        fields: {
          [departmentNameFieldId]: 'People Ops',
          [departmentBudgetFieldId]: 350000,
          [departmentLocationFieldId]: 'Remote',
        },
      },
    ],
  };

  const positionTitleFieldId = createFieldId();
  const positionDepartmentLinkFieldId = createFieldId();
  const positionDepartmentLookupFieldId = createFieldId();
  const positionTypeFieldId = createFieldId();
  const positionLevelFieldId = createFieldId();
  const positionOpeningsFieldId = createFieldId();
  const positionStatusFieldId = createFieldId();
  const positionHiringManagerFieldId = createFieldId();
  const positionSkillsFieldId = createFieldId();
  const frontendPositionRecordId = createRecordId();
  const peopleOpsPositionRecordId = createRecordId();

  const positionTypeOptions = [
    createSelectOption('Full-time', 'green'),
    createSelectOption('Part-time', 'yellow'),
    createSelectOption('Contract', 'purple'),
    createSelectOption('Intern', 'blue'),
  ];
  const positionLevelOptions = [
    createSelectOption('Junior', 'blue'),
    createSelectOption('Mid', 'teal'),
    createSelectOption('Senior', 'purple'),
    createSelectOption('Staff', 'orange'),
  ];
  const positionStatusOptions = [
    createSelectOption('Open', 'green'),
    createSelectOption('On Hold', 'yellow'),
    createSelectOption('Closed', 'red'),
  ];
  const skillOptions = [
    createSelectOption('TypeScript', 'blue'),
    createSelectOption('React', 'purple'),
    createSelectOption('People Ops', 'teal'),
    createSelectOption('Analytics', 'orange'),
  ];

  const positionsTable: TemplateTableSeed = {
    key: 'positions',
    name: 'Positions',
    description: 'Open roles and requisitions.',
    tableId: positionsTableId,
    fields: [
      { type: 'singleLineText', id: positionTitleFieldId, name: 'Title', isPrimary: true },
      {
        type: 'link',
        id: positionDepartmentLinkFieldId,
        name: 'Department',
        options: {
          relationship: 'manyOne',
          foreignTableId: departmentsTableId,
          lookupFieldId: departmentNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: positionDepartmentLookupFieldId,
        name: 'Department Name',
        options: {
          linkFieldId: positionDepartmentLinkFieldId,
          foreignTableId: departmentsTableId,
          lookupFieldId: departmentNameFieldId,
        },
      },
      {
        type: 'singleSelect',
        id: positionTypeFieldId,
        name: 'Type',
        options: {
          choices: positionTypeOptions,
          defaultValue: 'Full-time',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: positionLevelFieldId,
        name: 'Level',
        options: {
          choices: positionLevelOptions,
          defaultValue: 'Mid',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'number',
        id: positionOpeningsFieldId,
        name: 'Openings',
        options: { defaultValue: 1 },
      },
      {
        type: 'singleSelect',
        id: positionStatusFieldId,
        name: 'Status',
        options: {
          choices: positionStatusOptions,
          defaultValue: 'Open',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'user',
        id: positionHiringManagerFieldId,
        name: 'Hiring Manager',
        options: { isMultiple: false },
      },
      {
        type: 'multipleSelect',
        id: positionSkillsFieldId,
        name: 'Core Skills',
        options: {
          choices: skillOptions,
          defaultValue: [skillOptions[0]!.name, skillOptions[1]!.name],
        },
      },
    ],
    defaultRecordCount: 30,
    records: [
      {
        id: frontendPositionRecordId,
        fields: {
          [positionTitleFieldId]: 'Senior Frontend Engineer',
          [positionDepartmentLinkFieldId]: { id: engineeringDepartmentRecordId },
          [positionTypeFieldId]: positionTypeOptions[0]!.id,
          [positionLevelFieldId]: positionLevelOptions[2]!.id,
          [positionOpeningsFieldId]: 2,
          [positionStatusFieldId]: positionStatusOptions[0]!.id,
          [positionSkillsFieldId]: [skillOptions[0]!.id, skillOptions[1]!.id],
        },
      },
      {
        id: peopleOpsPositionRecordId,
        fields: {
          [positionTitleFieldId]: 'People Operations Specialist',
          [positionDepartmentLinkFieldId]: { id: peopleOpsDepartmentRecordId },
          [positionTypeFieldId]: positionTypeOptions[0]!.id,
          [positionLevelFieldId]: positionLevelOptions[1]!.id,
          [positionOpeningsFieldId]: 1,
          [positionStatusFieldId]: positionStatusOptions[0]!.id,
          [positionSkillsFieldId]: [skillOptions[2]!.id],
        },
      },
    ],
  };

  const employeeNameFieldId = createFieldId();
  const employeeEmailFieldId = createFieldId();
  const employeePhoneFieldId = createFieldId();
  const employeeDepartmentLinkFieldId = createFieldId();
  const employeeDepartmentLookupFieldId = createFieldId();
  const employeePositionLinkFieldId = createFieldId();
  const employeePositionLookupFieldId = createFieldId();
  const employeeStatusFieldId = createFieldId();
  const employeeHireDateFieldId = createFieldId();
  const employeeManagerFieldId = createFieldId();
  const employeeSalaryFieldId = createFieldId();
  const employeeBonusFieldId = createFieldId();
  const employeeTotalCompFieldId = createFieldId();
  const employeeRatingFieldId = createFieldId();
  const employeeSkillsFieldId = createFieldId();
  const employeeIsFullTimeFieldId = createFieldId();
  const employeeContractFileFieldId = createFieldId();
  const employeeNotesFieldId = createFieldId();
  const rileyEmployeeRecordId = createRecordId();
  const morganEmployeeRecordId = createRecordId();

  const employeeStatusOptions = [
    createSelectOption('Active', 'green'),
    createSelectOption('On Leave', 'yellow'),
    createSelectOption('Terminated', 'red'),
  ];

  const employeesTable: TemplateTableSeed = {
    key: 'employees',
    name: 'Employees',
    description: 'Employee directory and core HR data.',
    tableId: employeesTableId,
    fields: [
      { type: 'singleLineText', id: employeeNameFieldId, name: 'Name', isPrimary: true },
      {
        type: 'singleLineText',
        id: employeeEmailFieldId,
        name: 'Email',
        options: { showAs: { type: 'email' } },
      },
      { type: 'singleLineText', id: employeePhoneFieldId, name: 'Phone' },
      {
        type: 'link',
        id: employeeDepartmentLinkFieldId,
        name: 'Department',
        options: {
          relationship: 'manyOne',
          foreignTableId: departmentsTableId,
          lookupFieldId: departmentNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: employeeDepartmentLookupFieldId,
        name: 'Department Name',
        options: {
          linkFieldId: employeeDepartmentLinkFieldId,
          foreignTableId: departmentsTableId,
          lookupFieldId: departmentNameFieldId,
        },
      },
      {
        type: 'link',
        id: employeePositionLinkFieldId,
        name: 'Position',
        options: {
          relationship: 'manyOne',
          foreignTableId: positionsTableId,
          lookupFieldId: positionTitleFieldId,
        },
      },
      {
        type: 'lookup',
        id: employeePositionLookupFieldId,
        name: 'Position Title',
        options: {
          linkFieldId: employeePositionLinkFieldId,
          foreignTableId: positionsTableId,
          lookupFieldId: positionTitleFieldId,
        },
      },
      {
        type: 'singleSelect',
        id: employeeStatusFieldId,
        name: 'Status',
        options: {
          choices: employeeStatusOptions,
          defaultValue: 'Active',
          preventAutoNewOptions: true,
        },
      },
      { type: 'date', id: employeeHireDateFieldId, name: 'Hire Date' },
      { type: 'user', id: employeeManagerFieldId, name: 'Manager', options: { isMultiple: false } },
      {
        type: 'number',
        id: employeeSalaryFieldId,
        name: 'Base Salary',
        options: { formatting: { type: 'currency', precision: 0, symbol: '$' } },
      },
      {
        type: 'number',
        id: employeeBonusFieldId,
        name: 'Bonus',
        options: { formatting: { type: 'currency', precision: 0, symbol: '$' } },
      },
      {
        type: 'formula',
        id: employeeTotalCompFieldId,
        name: 'Total Compensation',
        options: {
          expression: `{${employeeSalaryFieldId}} + {${employeeBonusFieldId}}`,
          formatting: { type: 'currency', precision: 0, symbol: '$' },
        },
      },
      { type: 'rating', id: employeeRatingFieldId, name: 'Performance', max: 5 },
      {
        type: 'multipleSelect',
        id: employeeSkillsFieldId,
        name: 'Skills',
        options: {
          choices: skillOptions,
          defaultValue: [skillOptions[0]!.name],
        },
      },
      {
        type: 'checkbox',
        id: employeeIsFullTimeFieldId,
        name: 'Full Time',
        options: { defaultValue: true },
      },
      { type: 'attachment', id: employeeContractFileFieldId, name: 'Contract' },
      { type: 'longText', id: employeeNotesFieldId, name: 'Notes' },
    ],
    defaultRecordCount: 100,
    records: [
      {
        id: rileyEmployeeRecordId,
        fields: {
          [employeeNameFieldId]: 'Riley Chen',
          [employeeEmailFieldId]: 'riley@acme.example',
          [employeeDepartmentLinkFieldId]: { id: engineeringDepartmentRecordId },
          [employeePositionLinkFieldId]: { id: frontendPositionRecordId },
          [employeeStatusFieldId]: employeeStatusOptions[0]!.id,
          [employeeHireDateFieldId]: '2023-05-10T00:00:00.000Z',
          [employeeSalaryFieldId]: 165000,
          [employeeBonusFieldId]: 15000,
          [employeeRatingFieldId]: 4,
          [employeeSkillsFieldId]: [skillOptions[0]!.id, skillOptions[1]!.id],
        },
      },
      {
        id: morganEmployeeRecordId,
        fields: {
          [employeeNameFieldId]: 'Morgan Patel',
          [employeeEmailFieldId]: 'morgan@acme.example',
          [employeeDepartmentLinkFieldId]: { id: peopleOpsDepartmentRecordId },
          [employeePositionLinkFieldId]: { id: peopleOpsPositionRecordId },
          [employeeStatusFieldId]: employeeStatusOptions[1]!.id,
          [employeeHireDateFieldId]: '2022-11-01T00:00:00.000Z',
          [employeeSalaryFieldId]: 95000,
          [employeeBonusFieldId]: 8000,
          [employeeRatingFieldId]: 5,
          [employeeSkillsFieldId]: [skillOptions[2]!.id],
        },
      },
    ],
  };

  const applicationCandidateFieldId = createFieldId();
  const applicationEmailFieldId = createFieldId();
  const applicationPositionLinkFieldId = createFieldId();
  const applicationPositionLookupFieldId = createFieldId();
  const applicationPositionOpeningsFieldId = createFieldId();
  const applicationOpenPositionCountFieldId = createFieldId();
  const applicationStageFieldId = createFieldId();
  const applicationSourceFieldId = createFieldId();
  const applicationResumeFieldId = createFieldId();
  const applicationScoreFieldId = createFieldId();
  const applicationOfferSentFieldId = createFieldId();
  const applicationNotesFieldId = createFieldId();
  const applicationActionFieldId = createFieldId();

  const applicationStageOptions = [
    createSelectOption('Applied', 'blue'),
    createSelectOption('Screen', 'yellow'),
    createSelectOption('Interview', 'purple'),
    createSelectOption('Offer', 'green'),
    createSelectOption('Hired', 'teal'),
    createSelectOption('Rejected', 'red'),
  ];
  const applicationSourceOptions = [
    createSelectOption('Referral', 'green'),
    createSelectOption('LinkedIn', 'blue'),
    createSelectOption('Inbound', 'purple'),
    createSelectOption('Agency', 'orange'),
  ];

  const applicationsTable: TemplateTableSeed = {
    key: 'applications',
    name: 'Applications',
    description: 'Candidates and recruiting pipeline.',
    tableId: applicationsTableId,
    fields: [
      {
        type: 'singleLineText',
        id: applicationCandidateFieldId,
        name: 'Candidate',
        isPrimary: true,
      },
      {
        type: 'singleLineText',
        id: applicationEmailFieldId,
        name: 'Email',
        options: { showAs: { type: 'email' } },
      },
      {
        type: 'link',
        id: applicationPositionLinkFieldId,
        name: 'Position',
        options: {
          relationship: 'manyOne',
          foreignTableId: positionsTableId,
          lookupFieldId: positionTitleFieldId,
        },
      },
      {
        type: 'lookup',
        id: applicationPositionLookupFieldId,
        name: 'Position Title',
        options: {
          linkFieldId: applicationPositionLinkFieldId,
          foreignTableId: positionsTableId,
          lookupFieldId: positionTitleFieldId,
        },
      },
      {
        type: 'rollup',
        id: applicationPositionOpeningsFieldId,
        name: 'Position Openings',
        options: { expression: 'sum({values})' },
        config: {
          linkFieldId: applicationPositionLinkFieldId,
          foreignTableId: positionsTableId,
          lookupFieldId: positionOpeningsFieldId,
        },
      },
      {
        type: 'conditionalRollup',
        id: applicationOpenPositionCountFieldId,
        name: 'Open Position Count',
        options: { expression: 'count({values})' },
        config: {
          foreignTableId: positionsTableId,
          lookupFieldId: positionTitleFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: positionStatusFieldId,
                  operator: 'is',
                  value: positionStatusOptions[0]!.id,
                },
              ],
            },
          },
        },
      },
      {
        type: 'singleSelect',
        id: applicationStageFieldId,
        name: 'Stage',
        options: {
          choices: applicationStageOptions,
          defaultValue: 'Applied',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: applicationSourceFieldId,
        name: 'Source',
        options: {
          choices: applicationSourceOptions,
          defaultValue: 'Inbound',
          preventAutoNewOptions: true,
        },
      },
      { type: 'attachment', id: applicationResumeFieldId, name: 'Resume' },
      {
        type: 'number',
        id: applicationScoreFieldId,
        name: 'Score',
        options: { formatting: { type: 'decimal', precision: 0 } },
      },
      {
        type: 'checkbox',
        id: applicationOfferSentFieldId,
        name: 'Offer Sent',
        options: { defaultValue: false },
      },
      { type: 'longText', id: applicationNotesFieldId, name: 'Notes' },
      {
        type: 'button',
        id: applicationActionFieldId,
        name: 'Send Offer',
        options: {
          label: 'Send Offer',
          color: 'teal',
          maxCount: 1,
          resetCount: false,
        },
      },
    ],
    defaultRecordCount: 60,
    records: [
      {
        fields: {
          [applicationCandidateFieldId]: 'Jamie Rivera',
          [applicationEmailFieldId]: 'jamie.rivera@example.com',
          [applicationPositionLinkFieldId]: { id: frontendPositionRecordId },
          [applicationStageFieldId]: applicationStageOptions[2]!.id,
          [applicationSourceFieldId]: applicationSourceOptions[1]!.id,
          [applicationScoreFieldId]: 4,
          [applicationOfferSentFieldId]: false,
        },
      },
      {
        fields: {
          [applicationCandidateFieldId]: 'Casey Nguyen',
          [applicationEmailFieldId]: 'casey.nguyen@example.com',
          [applicationPositionLinkFieldId]: { id: peopleOpsPositionRecordId },
          [applicationStageFieldId]: applicationStageOptions[3]!.id,
          [applicationSourceFieldId]: applicationSourceOptions[0]!.id,
          [applicationScoreFieldId]: 5,
          [applicationOfferSentFieldId]: true,
        },
      },
    ],
  };

  const timeOffEmployeeLinkFieldId = createFieldId();
  const timeOffEmployeeLookupFieldId = createFieldId();
  const timeOffNameFieldId = createFieldId();
  const timeOffTypeFieldId = createFieldId();
  const timeOffStatusFieldId = createFieldId();
  const timeOffStartFieldId = createFieldId();
  const timeOffEndFieldId = createFieldId();
  const timeOffApprovedByFieldId = createFieldId();
  const timeOffNotesFieldId = createFieldId();

  const timeOffTypeOptions = [
    createSelectOption('Vacation', 'blue'),
    createSelectOption('Sick', 'red'),
    createSelectOption('Parental', 'purple'),
    createSelectOption('Unpaid', 'orange'),
  ];
  const timeOffStatusOptions = [
    createSelectOption('Requested', 'yellow'),
    createSelectOption('Approved', 'green'),
    createSelectOption('Declined', 'red'),
  ];

  const timeOffTable: TemplateTableSeed = {
    key: 'time-off',
    name: 'Time Off',
    description: 'Leave requests and balances.',
    tableId: timeOffTableId,
    fields: [
      { type: 'singleLineText', id: timeOffNameFieldId, name: 'Request', isPrimary: true },
      {
        type: 'link',
        id: timeOffEmployeeLinkFieldId,
        name: 'Employee',
        options: {
          relationship: 'manyOne',
          foreignTableId: employeesTableId,
          lookupFieldId: employeeNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: timeOffEmployeeLookupFieldId,
        name: 'Employee Name',
        options: {
          linkFieldId: timeOffEmployeeLinkFieldId,
          foreignTableId: employeesTableId,
          lookupFieldId: employeeNameFieldId,
        },
      },
      {
        type: 'singleSelect',
        id: timeOffTypeFieldId,
        name: 'Type',
        options: {
          choices: timeOffTypeOptions,
          defaultValue: 'Vacation',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: timeOffStatusFieldId,
        name: 'Status',
        options: {
          choices: timeOffStatusOptions,
          defaultValue: 'Requested',
          preventAutoNewOptions: true,
        },
      },
      { type: 'date', id: timeOffStartFieldId, name: 'Start Date' },
      { type: 'date', id: timeOffEndFieldId, name: 'End Date' },
      {
        type: 'user',
        id: timeOffApprovedByFieldId,
        name: 'Approved By',
        options: { isMultiple: false },
      },
      { type: 'longText', id: timeOffNotesFieldId, name: 'Notes' },
    ],
    defaultRecordCount: 40,
    records: [
      {
        fields: {
          [timeOffNameFieldId]: 'Spring vacation',
          [timeOffEmployeeLinkFieldId]: { id: rileyEmployeeRecordId },
          [timeOffTypeFieldId]: timeOffTypeOptions[0]!.id,
          [timeOffStatusFieldId]: timeOffStatusOptions[1]!.id,
          [timeOffStartFieldId]: '2025-03-04T00:00:00.000Z',
          [timeOffEndFieldId]: '2025-03-08T00:00:00.000Z',
        },
      },
      {
        fields: {
          [timeOffNameFieldId]: 'Parental leave',
          [timeOffEmployeeLinkFieldId]: { id: morganEmployeeRecordId },
          [timeOffTypeFieldId]: timeOffTypeOptions[2]!.id,
          [timeOffStatusFieldId]: timeOffStatusOptions[0]!.id,
          [timeOffStartFieldId]: '2025-04-01T00:00:00.000Z',
          [timeOffEndFieldId]: '2025-04-21T00:00:00.000Z',
        },
      },
    ],
  };

  const reviewEmployeeLinkFieldId = createFieldId();
  const reviewEmployeeLookupFieldId = createFieldId();
  const reviewNameFieldId = createFieldId();
  const reviewPeriodFieldId = createFieldId();
  const reviewScoreFieldId = createFieldId();
  const reviewReviewerFieldId = createFieldId();
  const reviewStrengthsFieldId = createFieldId();
  const reviewAreasFieldId = createFieldId();
  const reviewGoalsFieldId = createFieldId();

  const reviewGoalOptions = [
    createSelectOption('Leadership', 'purple'),
    createSelectOption('Delivery', 'green'),
    createSelectOption('Communication', 'blue'),
  ];

  const reviewsTable: TemplateTableSeed = {
    key: 'reviews',
    name: 'Performance Reviews',
    description: 'Periodic performance reviews.',
    tableId: reviewsTableId,
    fields: [
      { type: 'singleLineText', id: reviewNameFieldId, name: 'Review', isPrimary: true },
      {
        type: 'link',
        id: reviewEmployeeLinkFieldId,
        name: 'Employee',
        options: {
          relationship: 'manyOne',
          foreignTableId: employeesTableId,
          lookupFieldId: employeeNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: reviewEmployeeLookupFieldId,
        name: 'Employee Name',
        options: {
          linkFieldId: reviewEmployeeLinkFieldId,
          foreignTableId: employeesTableId,
          lookupFieldId: employeeNameFieldId,
        },
      },
      {
        type: 'singleSelect',
        id: reviewPeriodFieldId,
        name: 'Period',
        options: {
          choices: [createSelectOption('H1 2025', 'blue'), createSelectOption('H2 2025', 'purple')],
          defaultValue: 'H1 2025',
          preventAutoNewOptions: true,
        },
      },
      { type: 'rating', id: reviewScoreFieldId, name: 'Score', max: 5 },
      { type: 'user', id: reviewReviewerFieldId, name: 'Reviewer', options: { isMultiple: false } },
      { type: 'longText', id: reviewStrengthsFieldId, name: 'Strengths' },
      { type: 'longText', id: reviewAreasFieldId, name: 'Growth Areas' },
      {
        type: 'multipleSelect',
        id: reviewGoalsFieldId,
        name: 'Goals',
        options: {
          choices: reviewGoalOptions,
          defaultValue: [reviewGoalOptions[1]!.name],
        },
      },
    ],
    defaultRecordCount: 20,
    records: [
      {
        fields: {
          [reviewNameFieldId]: 'H1 2025 Review - Riley',
          [reviewEmployeeLinkFieldId]: { id: rileyEmployeeRecordId },
          [reviewScoreFieldId]: 4,
          [reviewStrengthsFieldId]: 'Strong delivery and collaboration.',
          [reviewAreasFieldId]: 'Expand cross-team influence.',
          [reviewGoalsFieldId]: [reviewGoalOptions[0]!.id],
        },
      },
      {
        fields: {
          [reviewNameFieldId]: 'H1 2025 Review - Morgan',
          [reviewEmployeeLinkFieldId]: { id: morganEmployeeRecordId },
          [reviewScoreFieldId]: 5,
          [reviewStrengthsFieldId]: 'Exceptional ownership and mentorship.',
          [reviewAreasFieldId]: 'Maintain sustainable pace.',
          [reviewGoalsFieldId]: [reviewGoalOptions[1]!.id],
        },
      },
    ],
  };

  return {
    tables: [
      departmentsTable,
      positionsTable,
      employeesTable,
      applicationsTable,
      timeOffTable,
      reviewsTable,
    ],
  };
};

const createAllFieldTypesTemplateSeed = (): TemplateSeed => {
  const companiesTableId = createTableId();
  const companyNameFieldId = createFieldId();
  const revenueFieldId = createFieldId();
  const allTypesCompanyRecordId = createRecordId();
  const northwindCompanyRecordId = createRecordId();
  const globexCompanyRecordId = createRecordId();

  const companiesTable: TemplateTableSeed = {
    key: 'companies',
    name: 'Companies',
    description: 'Referenced by link/lookup/rollup fields.',
    tableId: companiesTableId,
    fields: [
      { type: 'singleLineText', id: companyNameFieldId, name: 'Name', isPrimary: true },
      { type: 'number', id: revenueFieldId, name: 'Revenue' },
    ],
    defaultRecordCount: 12,
    records: [
      {
        id: allTypesCompanyRecordId,
        fields: { [companyNameFieldId]: 'Acme Inc.', [revenueFieldId]: 120 },
      },
      {
        id: northwindCompanyRecordId,
        fields: { [companyNameFieldId]: 'Northwind Traders', [revenueFieldId]: 80 },
      },
      {
        id: globexCompanyRecordId,
        fields: { [companyNameFieldId]: 'Globex', [revenueFieldId]: 200 },
      },
    ],
  };

  const allTypesTableId = createTableId();
  const nameFieldId = createFieldId();
  const descFieldId = createFieldId();
  const amountFieldId = createFieldId();
  const scoreFieldId = createFieldId();
  const scoreLabelFieldId = createFieldId();
  const priorityFieldId = createFieldId();
  const statusFieldId = createFieldId();
  const tagsFieldId = createFieldId();
  const doneFieldId = createFieldId();
  const filesFieldId = createFieldId();
  const dueDateFieldId = createFieldId();
  const ownerFieldId = createFieldId();
  const actionFieldId = createFieldId();
  const companyLinkFieldId = createFieldId();
  const companyLookupFieldId = createFieldId();
  const companyRevenueRollupFieldId = createFieldId();
  const conditionalCompanyLookupFieldId = createFieldId();
  const conditionalRevenueRollupFieldId = createFieldId();

  const statusOptions = [
    createSelectOption('Todo', 'blue'),
    createSelectOption('Doing', 'yellow'),
    createSelectOption('Done', 'green'),
  ];
  const tagOptions = [
    createSelectOption('Frontend', 'purple'),
    createSelectOption('Backend', 'orange'),
    createSelectOption('Bug', 'red'),
  ];

  const allTypesTable: TemplateTableSeed = {
    key: 'allTypes',
    name: 'All Field Types',
    description: 'All field types, including link/lookup/rollup.',
    tableId: allTypesTableId,
    fields: [
      {
        type: 'singleLineText',
        id: nameFieldId,
        name: 'Name',
        isPrimary: true,
        options: { showAs: { type: 'email' } },
      },
      {
        type: 'longText',
        id: descFieldId,
        name: 'Description',
        options: { defaultValue: 'Details' },
      },
      {
        type: 'number',
        id: amountFieldId,
        name: 'Amount',
        options: {
          formatting: { type: 'currency', precision: 2, symbol: '$' },
          showAs: { type: 'bar', color: 'teal', showValue: true, maxValue: 100 },
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
        id: priorityFieldId,
        name: 'Priority',
        options: { max: 5, icon: 'star', color: 'yellowBright' },
      },
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
        type: 'multipleSelect',
        id: tagsFieldId,
        name: 'Tags',
        options: { choices: tagOptions },
      },
      { type: 'checkbox', id: doneFieldId, name: 'Done', options: { defaultValue: true } },
      { type: 'attachment', id: filesFieldId, name: 'Files' },
      {
        type: 'date',
        id: dueDateFieldId,
        name: 'Due Date',
        options: {
          formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
        },
      },
      {
        type: 'user',
        id: ownerFieldId,
        name: 'Owner',
        options: { isMultiple: true, shouldNotify: false },
      },
      {
        type: 'button',
        id: actionFieldId,
        name: 'Action',
        options: {
          label: 'Run',
          color: 'teal',
          maxCount: 3,
          resetCount: true,
          workflow: { id: 'wflaaaaaaaaaaaaaaaa', name: 'Deploy', isActive: true },
        },
      },
      {
        type: 'link',
        id: companyLinkFieldId,
        name: 'Company',
        options: {
          relationship: 'manyOne',
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: companyLookupFieldId,
        name: 'Company Name',
        options: {
          linkFieldId: companyLinkFieldId,
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'rollup',
        id: companyRevenueRollupFieldId,
        name: 'Company Revenue Total',
        options: { expression: 'sum({values})' },
        config: {
          linkFieldId: companyLinkFieldId,
          foreignTableId: companiesTableId,
          lookupFieldId: revenueFieldId,
        },
      },
      {
        type: 'conditionalLookup',
        id: conditionalCompanyLookupFieldId,
        name: 'High Revenue Companies',
        options: {
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: revenueFieldId,
                  operator: 'isGreater',
                  value: 100,
                },
              ],
            },
          },
        },
      },
      {
        type: 'conditionalRollup',
        id: conditionalRevenueRollupFieldId,
        name: 'High Revenue Total',
        options: { expression: 'sum({values})' },
        config: {
          foreignTableId: companiesTableId,
          lookupFieldId: revenueFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: revenueFieldId,
                  operator: 'isGreater',
                  value: 100,
                },
              ],
            },
          },
        },
      },
    ],
    defaultRecordCount: 30,
    records: [
      {
        fields: {
          [nameFieldId]: 'owner+1@example.com',
          [descFieldId]: 'First record',
          [amountFieldId]: 10,
          [priorityFieldId]: 4,
          [statusFieldId]: statusOptions[0]!.id,
          [tagsFieldId]: [tagOptions[0]!.id, tagOptions[2]!.id],
          [doneFieldId]: true,
          [dueDateFieldId]: '2025-02-10T00:00:00.000Z',
          [companyLinkFieldId]: { id: allTypesCompanyRecordId },
        },
      },
      {
        fields: {
          [nameFieldId]: 'owner+2@example.com',
          [descFieldId]: 'Second record',
          [amountFieldId]: 25,
          [priorityFieldId]: 2,
          [statusFieldId]: statusOptions[1]!.id,
          [tagsFieldId]: [tagOptions[1]!.id],
          [doneFieldId]: false,
          [dueDateFieldId]: '2025-02-12T00:00:00.000Z',
          [companyLinkFieldId]: { id: northwindCompanyRecordId },
        },
      },
    ],
  };

  return { tables: [allTypesTable, companiesTable] };
};

export const createTextColumns = (count: number): ICreateTableRequestDto['fields'] =>
  Array.from({ length: count }, (_, index) => ({
    type: 'singleLineText',
    name: `Column ${index + 1}`,
  }));

export const simpleTableTemplate = singleTable(
  'simple-3',
  'Simple 3 Columns',
  'Single line text, number, and checkbox fields.',
  createSimpleSeed,
  3
);

export const allBaseFieldsTemplate = singleTable(
  'all-base-fields',
  'All Base Fields',
  'Common field types without formulas.',
  createAllBaseFieldsSeed,
  3
);

export const todoTemplate = singleTable(
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
  createBugTriageTemplateSeed,
  3
);

export const crmTemplate = createTemplate(
  'crm',
  'CRM (HubSpot)',
  'HubSpot-style CRM with companies, contacts, deals, tickets, and activities.',
  createCrmHubspotTemplateSeed,
  2
);

export const hrManagementTemplate = createTemplate(
  'hr-management',
  'HR Management',
  'HR operations with departments, employees, hiring, time off, and reviews.',
  createHrManagementTemplateSeed,
  2
);

export const contentCalendarTemplate = singleTable(
  'content-calendar',
  'Content Calendar',
  'Plan content with channels, status, and publish dates.',
  createContentCalendarSeed,
  3
);

export const projectTrackerTemplate = singleTable(
  'project-tracker',
  'Project Tracker',
  'Track work items with status, progress, and budget.',
  createProjectTrackerSeed,
  3
);

export const personalFinanceTemplate = singleTable(
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
  createAllFieldTypesTemplateSeed,
  2
);

export const tableTemplates = [
  simpleTableTemplate,
  allBaseFieldsTemplate,
  todoTemplate,
  bugTriageTemplate,
  crmTemplate,
  hrManagementTemplate,
  contentCalendarTemplate,
  projectTrackerTemplate,
  personalFinanceTemplate,
  allFieldTypesTemplate,
] as const;

export type TableTemplateKey = (typeof tableTemplates)[number]['key'];

export const getTableTemplate = (key: TableTemplateKey): TableTemplateDefinition | undefined =>
  tableTemplates.find((template) => template.key === key);
