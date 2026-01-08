import type { ICreateTableRequestDto } from '@teable/v2-contract-http';

import type { SingleTableSeed } from '../types';
import { createFieldId, createSelectOption, singleTable } from '../utils';

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

export const personalFinanceTemplate = singleTable(
  'personal-finance',
  'Personal Finance',
  'Log transactions with categories, amounts, and accounts.',
  createPersonalFinanceSeed,
  4
);
