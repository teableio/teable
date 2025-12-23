import type { ICreateTableRequestDto } from '@teable/v2-contract-http';
import { FieldId } from '@teable/v2-core';

const createFieldId = (): string => {
  const result = FieldId.generate();
  if (result.isOk()) return result.value.toString();
  const fallback = Math.random().toString(36).slice(2).padEnd(16, '0').slice(0, 16);
  return `fld${fallback}`;
};

const buildBasicTableFields = (): ICreateTableRequestDto['fields'] => {
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

export const buildBasicTableInput = (baseId: string, name: string): ICreateTableRequestDto => ({
  baseId,
  name,
  fields: buildBasicTableFields(),
});
