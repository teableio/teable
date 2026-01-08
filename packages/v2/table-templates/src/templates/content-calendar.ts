import type { ICreateTableRequestDto } from '@teable/v2-contract-http';

import type { SingleTableSeed } from '../types';
import { createFieldId, createSelectOption, singleTable } from '../utils';

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

export const contentCalendarTemplate = singleTable(
  'content-calendar',
  'Content Calendar',
  'Plan content with channels, status, and publish dates.',
  createContentCalendarSeed,
  3
);
