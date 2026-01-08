/* eslint-disable sonarjs/no-duplicate-string */
import type { ICreateTableRequestDto } from '@teable/v2-contract-http';

import type { TemplateTableSeed, TemplateSeed } from '../types';
import {
  createFieldId,
  createRecordId,
  createSelectOption,
  createTableId,
  createTemplate,
} from '../utils';

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

export const allFieldTypesTemplate = createTemplate(
  'all-field-types',
  'All Field Types',
  'All field types, including link/lookup/rollup.',
  createAllFieldTypesTemplateSeed,
  2
);
