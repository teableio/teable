import { beforeAll, describe, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type DuplicateFieldCase = {
  label: string;
  fieldType: string;
  fieldConfig?: Record<string, unknown>;
  recordValue: unknown;
  expectedCopiedValue: unknown;
  expectedNoCopyValue: unknown;
  setupNotes: string;
};

type DuplicateFieldErrorCase = {
  label: string;
  fieldType: string;
  fieldConfig?: Record<string, unknown>;
  recordValue: unknown;
  expectedError: string;
  setupNotes: string;
};

const duplicateFieldCases: DuplicateFieldCase[] = [
  {
    label: 'singleLineText',
    fieldType: 'singleLineText',
    fieldConfig: {},
    recordValue: 'Hello',
    expectedCopiedValue: 'Hello',
    expectedNoCopyValue: undefined,
    setupNotes:
      'Create table with primary Title + singleLineText field; set record value to "Hello".',
  },
  {
    label: 'longText',
    fieldType: 'longText',
    fieldConfig: {},
    recordValue: 'Long text value',
    expectedCopiedValue: 'Long text value',
    expectedNoCopyValue: undefined,
    setupNotes: 'Create table with primary Title + longText field; set record value.',
  },
  {
    label: 'number',
    fieldType: 'number',
    fieldConfig: {},
    recordValue: 123.45,
    expectedCopiedValue: 123.45,
    expectedNoCopyValue: undefined,
    setupNotes: 'Create table with primary Title + number field; set record value.',
  },
  {
    label: 'rating',
    fieldType: 'rating',
    fieldConfig: {},
    recordValue: 4,
    expectedCopiedValue: 4,
    expectedNoCopyValue: undefined,
    setupNotes: 'Create table with primary Title + rating field; set record value.',
  },
  {
    label: 'checkbox',
    fieldType: 'checkbox',
    fieldConfig: {},
    recordValue: true,
    expectedCopiedValue: true,
    expectedNoCopyValue: undefined,
    setupNotes: 'Create table with primary Title + checkbox field; set record value.',
  },
  {
    label: 'date',
    fieldType: 'date',
    fieldConfig: {},
    recordValue: '2024-01-02',
    expectedCopiedValue: '2024-01-02',
    expectedNoCopyValue: undefined,
    setupNotes: 'Create table with primary Title + date field; set ISO date string.',
  },
  {
    label: 'singleSelect',
    fieldType: 'singleSelect',
    fieldConfig: {
      options: [{ name: 'A', color: 'blue' }],
      defaultValue: { name: 'A', color: 'blue' },
    },
    recordValue: 'A',
    expectedCopiedValue: 'A',
    expectedNoCopyValue: undefined,
    setupNotes: 'Create table with primary Title + singleSelect field; select option A.',
  },
  {
    label: 'multipleSelect',
    fieldType: 'multipleSelect',
    fieldConfig: {
      options: [
        { name: 'A', color: 'blue' },
        { name: 'B', color: 'green' },
      ],
    },
    recordValue: ['A', 'B'],
    expectedCopiedValue: ['A', 'B'],
    expectedNoCopyValue: [],
    setupNotes: 'Create table with primary Title + multipleSelect field; select A+B.',
  },
  {
    label: 'user',
    fieldType: 'user',
    fieldConfig: {},
    recordValue: [{ id: 'usrTestUserId' }],
    expectedCopiedValue: [{ id: 'usrTestUserId' }],
    expectedNoCopyValue: [],
    setupNotes: 'Create table with primary Title + user field; set to ctx.testUser.',
  },
  {
    label: 'attachment',
    fieldType: 'attachment',
    fieldConfig: {},
    recordValue: [{ name: 'file.txt', url: 'https://example.com/file.txt' }],
    expectedCopiedValue: [{ name: 'file.txt', url: 'https://example.com/file.txt' }],
    expectedNoCopyValue: [],
    setupNotes: 'Create table with primary Title + attachment field; use fake attachment value.',
  },
  {
    label: 'formula',
    fieldType: 'formula',
    fieldConfig: { expression: '{Number} + 1' },
    recordValue: 2,
    expectedCopiedValue: 2,
    expectedNoCopyValue: 2,
    setupNotes:
      'Create table with number field + formula; create record with number=1; formula should read 2 on both source and duplicated field.',
  },
  {
    label: 'rollup',
    fieldType: 'rollup',
    fieldConfig: { expression: 'SUM(values)' },
    recordValue: 10,
    expectedCopiedValue: 10,
    expectedNoCopyValue: 10,
    setupNotes:
      'Create link + rollup; create linked records; ensure rollup value is computed; duplicated field should compute same.',
  },
  {
    label: 'conditionalRollup',
    fieldType: 'conditionalRollup',
    fieldConfig: { expression: 'SUM(values)' },
    recordValue: 10,
    expectedCopiedValue: 10,
    expectedNoCopyValue: 10,
    setupNotes:
      'Create conditionalRollup based on condition; computed value should match on duplicated field.',
  },
  {
    label: 'conditionalLookup',
    fieldType: 'conditionalLookup',
    fieldConfig: {},
    recordValue: 'Foo',
    expectedCopiedValue: 'Foo',
    expectedNoCopyValue: 'Foo',
    setupNotes:
      'Create conditionalLookup over foreign table; computed value should match on duplicated field.',
  },
  {
    label: 'createdTime',
    fieldType: 'createdTime',
    fieldConfig: {},
    recordValue: '<<timestamp>>',
    expectedCopiedValue: '<<timestamp>>',
    expectedNoCopyValue: '<<timestamp>>',
    setupNotes:
      'Create record and capture createdTime; duplicated field should read the same createdTime.',
  },
  {
    label: 'lastModifiedTime',
    fieldType: 'lastModifiedTime',
    fieldConfig: {},
    recordValue: '<<timestamp>>',
    expectedCopiedValue: '<<timestamp>>',
    expectedNoCopyValue: '<<timestamp>>',
    setupNotes: 'Update record to set lastModifiedTime; duplicated field should read same value.',
  },
  {
    label: 'createdBy',
    fieldType: 'createdBy',
    fieldConfig: {},
    recordValue: { id: 'usrTestUserId' },
    expectedCopiedValue: { id: 'usrTestUserId' },
    expectedNoCopyValue: { id: 'usrTestUserId' },
    setupNotes: 'Create record as ctx.testUser; duplicated field should show same user.',
  },
  {
    label: 'lastModifiedBy',
    fieldType: 'lastModifiedBy',
    fieldConfig: {},
    recordValue: { id: 'usrTestUserId' },
    expectedCopiedValue: { id: 'usrTestUserId' },
    expectedNoCopyValue: { id: 'usrTestUserId' },
    setupNotes: 'Update record as ctx.testUser; duplicated field should show same user.',
  },
  {
    label: 'autoNumber',
    fieldType: 'autoNumber',
    fieldConfig: {},
    recordValue: 1,
    expectedCopiedValue: 1,
    expectedNoCopyValue: 1,
    setupNotes:
      'Create record to get autoNumber; duplicated field should show same value for that record.',
  },
  {
    label: 'button',
    fieldType: 'button',
    fieldConfig: { label: 'Click', color: 'teal' },
    recordValue: null,
    expectedCopiedValue: null,
    expectedNoCopyValue: null,
    setupNotes: 'Button field may be non-storable; verify duplicated field remains null.',
  },
  {
    label: 'link manyMany',
    fieldType: 'link',
    fieldConfig: { relationship: 'manyMany' },
    recordValue: [{ id: '<<foreignRecordId>>' }],
    expectedCopiedValue: [{ id: '<<foreignRecordId>>' }],
    expectedNoCopyValue: [],
    setupNotes:
      'Create foreign table + records; set link values; duplicated field should reference same linked records.',
  },
  {
    label: 'link oneMany(one-way)',
    fieldType: 'link',
    fieldConfig: { relationship: 'oneMany', isOneWay: true },
    recordValue: [{ id: '<<foreignRecordId>>' }],
    expectedCopiedValue: [{ id: '<<foreignRecordId>>' }],
    expectedNoCopyValue: [],
    setupNotes:
      'Create foreign table + records; set link values; duplicated field should reference same linked records.',
  },
  {
    label: 'link manyOne',
    fieldType: 'link',
    fieldConfig: { relationship: 'manyOne' },
    recordValue: { id: '<<foreignRecordId>>' },
    expectedCopiedValue: { id: '<<foreignRecordId>>' },
    expectedNoCopyValue: null,
    setupNotes:
      'Create foreign table + records; set link value; duplicated field should reference same linked record.',
  },
  {
    label: 'link oneOne',
    fieldType: 'link',
    fieldConfig: { relationship: 'oneOne' },
    recordValue: { id: '<<foreignRecordId>>' },
    expectedCopiedValue: { id: '<<foreignRecordId>>' },
    expectedNoCopyValue: null,
    setupNotes:
      'Create foreign table + records; set link value; duplicated field should reference same linked record.',
  },
];

const duplicateFieldErrorCases: DuplicateFieldErrorCase[] = [
  {
    label: 'lookup',
    fieldType: 'lookup',
    fieldConfig: {},
    recordValue: '<<computed>>',
    expectedError: 'field.lookup_cannot_duplicate',
    setupNotes:
      'Create lookup field (link+lookup); duplicate should fail with lookup cannot duplicate error.',
  },
];

describe('duplicateField', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  describe.each(duplicateFieldCases)('duplicate field with values: $label', (caseInfo) => {
    it.todo(`includeRecordValues=true should copy values; setup: ${caseInfo.setupNotes}`);
  });

  describe.each(duplicateFieldCases)('duplicate field without values: $label', (caseInfo) => {
    it.todo(`includeRecordValues=false should not copy values; setup: ${caseInfo.setupNotes}`);
  });

  describe.each(duplicateFieldErrorCases)('duplicate field error: $label', (caseInfo) => {
    it.todo(`should fail with ${caseInfo.expectedError}; setup: ${caseInfo.setupNotes}`);
  });
});
