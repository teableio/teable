import fs from 'fs';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import {
  Colors,
  computeSearchHitIndex,
  DateFormattingPreset,
  FieldKeyType,
  FieldType,
  NumberFormattingType,
  RatingIcon,
  Relationship,
  TimeFormatting,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createRecords,
  getRecords as apiGetRecords,
  getSearchIndex,
  uploadAttachment,
} from '@teable/openapi';
import StorageAdapter from '../src/features/attachments/plugins/adapter';
import { createFieldInstanceByVo } from '../src/features/field/model/factory';
import {
  createBase,
  createSpace,
  createTable,
  permanentDeleteSpace,
  initApp,
  getFields,
} from './utils/init-app';

/**
 * Reconciliation suite: for the same data set, server-side search hits
 * (aggregation/search-index, the same SQL semantics that filter rows) must
 * agree with client-side hits (computeSearchHitIndex from @teable/core, the
 * same code that highlights cells). Field eligibility is structurally shared
 * via FieldCore.isSearchable; this locks the value-level matching semantics.
 */
describe('Search consistency between server and client (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  let subTable: ITableFullVo;
  let viewId: string;
  let spaceId: string | undefined;
  let baseId: string | undefined;

  const fieldId = (name: string) => {
    const field = table.fields.find((f) => f.name === name);
    if (!field) throw new Error(`field ${name} not found`);
    return field.id;
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    const space = await createSpace({ name: 'search-consistency-space' });
    spaceId = space.id;
    const base = await createBase({ name: 'search-consistency-base', spaceId });
    baseId = base.id;

    subTable = await createTable(baseId, {
      name: 'search-consistency-sub',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'Sub Record A' } }, { fields: { Name: 'Sub Record B' } }],
      fieldKeyType: FieldKeyType.Name,
    });

    table = await createTable(baseId, {
      name: 'search-consistency-main',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        {
          name: 'Amount',
          type: FieldType.Number,
          options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
        },
        {
          name: 'Stars',
          type: FieldType.Rating,
          options: { icon: RatingIcon.Star, color: Colors.YellowBright, max: 5 },
        },
        {
          name: 'Due',
          type: FieldType.Date,
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.None,
              timeZone: 'Asia/Singapore',
            },
          },
        },
        {
          name: 'Status',
          type: FieldType.SingleSelect,
          options: {
            choices: [
              { name: 'Open', color: Colors.Cyan },
              { name: 'Closed', color: Colors.Gray },
            ],
          },
        },
        {
          name: 'Tags',
          type: FieldType.MultipleSelect,
          options: {
            choices: [
              { name: 'alpha', color: Colors.Cyan },
              { name: 'beta', color: Colors.Blue },
              { name: 'gamma', color: Colors.Gray },
            ],
          },
        },
        { name: 'Done', type: FieldType.Checkbox },
        { name: 'Files', type: FieldType.Attachment },
      ],
      records: [],
    });
    viewId = table.views[0].id;

    const titleId = fieldId('Title');
    const amountId = fieldId('Amount');
    const dueId = fieldId('Due');

    await createField(table.id, {
      name: 'Link',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyMany, foreignTableId: subTable.id, isOneWay: true },
    });
    await createField(table.id, {
      name: 'TextFormula',
      type: FieldType.Formula,
      options: { expression: `{${titleId}}` },
    });
    await createField(table.id, {
      name: 'NumberFormula',
      type: FieldType.Formula,
      options: { expression: `{${amountId}} * 2` },
    });
    await createField(table.id, {
      name: 'DateFormula',
      type: FieldType.Formula,
      options: { expression: `{${dueId}}` },
    });
    await createField(table.id, {
      name: 'BoolFormula',
      type: FieldType.Formula,
      options: { expression: `{${amountId}} > 1` },
    });
    table.fields = await getFields(table.id);

    const { records: createdRecords } = (
      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [fieldId('Title')]: 'Apple Pie',
              [fieldId('Amount')]: 1.5,
              [fieldId('Stars')]: 3,
              [fieldId('Due')]: '2026-01-15T00:00:00.000Z',
              [fieldId('Status')]: 'Open',
              [fieldId('Tags')]: ['alpha', 'beta'],
              [fieldId('Done')]: true,
              [fieldId('Link')]: [{ id: subTable.records[0].id }],
            },
          },
          {
            fields: {
              [fieldId('Title')]: 'banana split',
              [fieldId('Amount')]: 100,
              [fieldId('Tags')]: ['gamma'],
            },
          },
          {
            fields: {
              [fieldId('Title')]: '50% off_sale',
              [fieldId('Stars')]: 5,
            },
          },
          { fields: { [fieldId('Title')]: 'TRUE Story' } },
          { fields: {} },
        ],
      })
    ).data;

    const tmpPath = path.resolve(
      path.join(StorageAdapter.TEMPORARY_DIR, 'search-consistency-invoice-report.txt')
    );
    fs.writeFileSync(tmpPath, 'attachment content');
    try {
      await uploadAttachment(
        table.id,
        createdRecords[0].id,
        fieldId('Files'),
        fs.createReadStream(tmpPath)
      );
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  afterAll(async () => {
    if (spaceId) {
      await permanentDeleteSpace(spaceId);
    }
    await app?.close();
  });

  const toKey = (hit: { recordId: string; fieldId: string }) => `${hit.recordId}:${hit.fieldId}`;

  const fetchServerHits = async (search: [string, string, boolean]) => {
    const { data } = await getSearchIndex(table.id, { viewId, take: 1000, search });
    // an empty hit response has no body, so data may be '' instead of null
    return new Set(Array.isArray(data) ? data.map(toKey) : []);
  };

  const computeClientHits = async (search: [string, string, boolean]) => {
    const { records } = (
      await apiGetRecords(table.id, { viewId, fieldKeyType: FieldKeyType.Id, take: 1000 })
    ).data;
    const fields = table.fields.map(createFieldInstanceByVo);
    const hits = computeSearchHitIndex(
      records.map((r) => ({ id: r.id, fields: r.fields })),
      fields,
      search
    );
    return new Set((hits ?? []).map(toKey));
  };

  type ICase = { name: string; keyword: string; scope?: () => string };
  const cases: ICase[] = [
    { name: 'plain text, all fields', keyword: 'apple' },
    { name: 'case-insensitive text, all fields', keyword: 'APPLE' },
    { name: 'numeric keyword, all fields', keyword: '1.5' },
    { name: 'numeric fragment, all fields', keyword: '.5' },
    { name: 'integer keyword, all fields', keyword: '100' },
    { name: 'date-like keyword, all fields (datetime excluded)', keyword: '2026' },
    { name: 'like wildcard percent, all fields', keyword: '%' },
    { name: 'like wildcard underscore, all fields', keyword: '_' },
    { name: 'multi select option, all fields', keyword: 'alpha' },
    { name: 'single select lowercase, all fields', keyword: 'open' },
    { name: 'boolean-like keyword, all fields (boolean excluded)', keyword: 'true' },
    { name: 'multi-value join boundary, all fields', keyword: 'a, b' },
    { name: 'link title, all fields', keyword: 'sub record' },
    { name: 'date scoped to date field', keyword: '2026', scope: () => fieldId('Due') },
    { name: 'text scoped to text field', keyword: 'apple', scope: () => fieldId('Title') },
    {
      name: 'numeric scoped to several fields',
      keyword: '1.5',
      scope: () => `${fieldId('Amount')},${fieldId('Stars')}`,
    },
    { name: 'link scoped to link field', keyword: 'sub record', scope: () => fieldId('Link') },
  ];

  it.each(cases)('agrees on $name', async ({ keyword, scope }) => {
    const search: [string, string, boolean] = [keyword, scope?.() ?? '', false];
    const serverHits = await fetchServerHits(search);
    const clientHits = await computeClientHits(search);
    expect([...clientHits].sort()).toEqual([...serverHits].sort());
  });
  // attachments are excluded from search on both sides (AttachmentFieldCore
  // isSearchable returns false; the server consumes the same predicate):
  // server-side matching could only run over the stored JSON text, which
  // produced noise hits for mimetype/path keywords like "png" or "pdf"
  it('never matches attachment fields on either side', async () => {
    const { records } = (
      await apiGetRecords(table.id, { viewId, fieldKeyType: FieldKeyType.Id, take: 1000 })
    ).data;
    const attach = (records[0].fields[fieldId('Files')] as { name: string; token: string }[])[0];

    const keywordsByScope: [string, string][] = [
      ['invoice', ''],
      ['invoice', fieldId('Files')],
      [attach.token, ''],
      ['text/plain', ''],
      ['mimetype', ''],
    ];
    for (const [keyword, scope] of keywordsByScope) {
      const search: [string, string, boolean] = [keyword, scope, false];
      const serverHits = await fetchServerHits(search);
      const clientHits = await computeClientHits(search);
      expect(serverHits.size).toBe(0);
      expect(clientHits.size).toBe(0);
    }
  });
});
