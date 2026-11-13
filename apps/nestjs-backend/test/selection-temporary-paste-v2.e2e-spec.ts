/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { ISelectFieldOptions } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import { axios, X_CANARY_HEADER } from '@teable/openapi';
import { SelectionService } from '../src/features/selection/selection.service';
import {
  createField,
  createTable,
  getField,
  getRecords,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('Selection temporaryPaste (native v2 HTTP)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const tables: string[] = [];

  beforeAll(async () => {
    app = (await initApp()).app;
  });

  afterEach(async () => {
    for (const tableId of tables.splice(0)) await permanentDeleteTable(baseId, tableId);
  });

  afterAll(async () => {
    await app?.close();
  });

  const preview = (tableId: string, body: unknown, useV2 = true) =>
    axios.patch(`/table/${tableId}/selection/temporaryPaste`, body, {
      headers: { [X_CANARY_HEADER]: String(useV2) },
      validateStatus: () => true,
    });

  it('converts pasted values and persists choices without a legacy preview or record write', async () => {
    const table = await createTable(baseId, {
      name: 'native temporary values',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Amount', type: FieldType.Number },
        { name: 'Choice', type: FieldType.SingleSelect, options: { choices: [] } },
      ],
      records: [{ fields: { Title: 'unchanged', Amount: 7 } }],
    });
    tables.push(table.id);
    const before = await getRecords(table.id);
    const service = app.get(SelectionService);
    const legacy = service.temporaryPaste;
    let response;
    try {
      Object.defineProperty(service, 'temporaryPaste', { configurable: true, value: undefined });
      response = await preview(table.id, {
        viewId: table.views[0].id,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: 'candidate\t42\tnew-choice',
      });
    } finally {
      Object.defineProperty(service, 'temporaryPaste', { configurable: true, value: legacy });
    }
    expect(response.status, JSON.stringify(response.data)).toBe(200);
    expect(response.headers['x-teable-v2']).toBe('true');
    expect(response.data).toEqual([
      {
        fields: {
          [table.fields[0].id]: 'candidate',
          [table.fields[1].id]: 42,
          [table.fields[2].id]: 'new-choice',
        },
      },
    ]);
    const options = (await getField(table.id, table.fields[2].id)).options as ISelectFieldOptions;
    expect(options.choices.map((choice) => choice.name)).toEqual(['new-choice']);
    expect((await getRecords(table.id)).records).toEqual(before.records);
  });

  it('honors a viewless ordered projection without changing persisted values', async () => {
    const table = await createTable(baseId, {
      name: 'temporary projection',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Amount', type: FieldType.Number },
      ],
      records: [{ fields: { Title: 'original', Amount: 7 } }],
    });
    tables.push(table.id);
    const before = await getRecords(table.id);
    const response = await preview(table.id, {
      projection: [table.fields[1].id, table.fields[0].id],
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [['12', 'candidate']],
    });
    expect(response.status, JSON.stringify(response.data)).toBe(200);
    expect(response.data).toEqual([
      {
        fields: {
          [table.fields[1].id]: 12,
          [table.fields[0].id]: 'candidate',
        },
      },
    ]);
    expect((await getRecords(table.id)).records).toEqual(before.records);
  });

  it('tiles typed clipboard values using source display formatting without creating records', async () => {
    const table = await createTable(baseId, {
      name: 'temporary typed clipboard',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        {
          name: 'Rate',
          type: FieldType.Number,
          options: { formatting: { type: 'percent', precision: 1 } },
        },
      ],
      records: [{ fields: { Title: 'original', Rate: 0.5 } }],
    });
    tables.push(table.id);
    const before = await getRecords(table.id);
    const response = await preview(table.id, {
      projection: [table.fields[0].id],
      ranges: [
        [0, 0],
        [0, 1],
      ],
      content: [[0.25]],
      header: [table.fields[1]],
    });
    expect(response.status, JSON.stringify(response.data)).toBe(200);
    expect(response.data).toEqual([
      { fields: { [table.fields[0].id]: '25.0%' } },
      { fields: { [table.fields[0].id]: '25.0%' } },
    ]);
    expect((await getRecords(table.id)).records).toEqual(before.records);
  });

  it('rolls back an earlier valid choice when a later select name exceeds the limit', async () => {
    const table = await createTable(baseId, {
      name: 'temporary choice rollback',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'First', type: FieldType.SingleSelect, options: { choices: [] } },
        { name: 'Last', type: FieldType.MultipleSelect, options: { choices: [] } },
      ],
      records: [{ fields: { Title: 'original' } }],
    });
    tables.push(table.id);
    const before = await getRecords(table.id);
    const response = await preview(table.id, {
      projection: [table.fields[1].id, table.fields[2].id],
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [['valid-new-choice', 'x'.repeat(1001)]],
    });
    expect(response.status, JSON.stringify(response.data)).toBe(400);
    expect(response.data.message).not.toContain('x'.repeat(1001));
    for (const field of table.fields.slice(1)) {
      expect((await getField(table.id, field.id)).options).toEqual(field.options);
    }
    expect((await getRecords(table.id)).records).toEqual(before.records);
  });

  it('keeps an explicit empty projection empty', async () => {
    const table = await createTable(baseId, {
      name: 'temporary empty projection',
      fields: [{ name: 'Choice', type: FieldType.SingleSelect, options: { choices: [] } }],
      records: [{ fields: {} }],
    });
    tables.push(table.id);
    const before = await getRecords(table.id);
    const response = await preview(table.id, {
      projection: [],
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: 'must-not-be-created',
    });
    expect(response.status, JSON.stringify(response.data)).toBe(200);
    expect(response.data).toEqual([{ fields: {} }]);
    expect((await getField(table.id, table.fields[0].id)).options).toEqual(table.fields[0].options);
    expect((await getRecords(table.id)).records).toEqual(before.records);
  });

  it('retains the explicit v1 public preview contract', async () => {
    const table = await createTable(baseId, {
      name: 'temporary v1 control',
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      records: [{ fields: { Title: 'unchanged' } }],
    });
    tables.push(table.id);
    const before = await getRecords(table.id);
    const previous = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'false';
    try {
      const response = await preview(
        table.id,
        {
          projection: [table.fields[0].id],
          ranges: [
            [0, 0],
            [0, 0],
          ],
          content: 'candidate',
        },
        false
      );
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      expect(response.headers['x-teable-v2']).toBe('false');
      expect(response.data).toEqual([{ fields: { [table.fields[0].id]: 'candidate' } }]);
    } finally {
      if (previous === undefined) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previous;
    }
    expect((await getRecords(table.id)).records).toEqual(before.records);
  });

  it('resolves foreign titles without creating destination or foreign records', async () => {
    const foreign = await createTable(baseId, {
      name: 'temporary foreign lookup',
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      records: [{ fields: { Title: 'known-title' } }],
    });
    tables.push(foreign.id);
    const table = await createTable(baseId, {
      name: 'temporary links',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        {
          name: 'Links',
          type: FieldType.Link,
          options: { relationship: Relationship.ManyMany, foreignTableId: foreign.id },
        },
      ],
      records: [{ fields: { Title: 'unchanged' } }],
    });
    tables.unshift(table.id);
    const before = await getRecords(table.id);
    const foreignBefore = await getRecords(foreign.id);
    const response = await preview(table.id, {
      projection: [table.fields[1].id],
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: 'known-title',
    });
    expect(response.status, JSON.stringify(response.data)).toBe(200);
    expect(response.data).toEqual([
      { fields: { [table.fields[1].id]: [{ id: foreign.records[0].id, title: 'known-title' }] } },
    ]);
    const missing = await preview(table.id, {
      projection: [table.fields[1].id],
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: 'missing-title',
    });
    expect(missing.status, JSON.stringify(missing.data)).toBe(200);
    expect(missing.data).toEqual([{ fields: { [table.fields[1].id]: null } }]);
    expect((await getRecords(table.id)).records).toEqual(before.records);
    expect((await getRecords(foreign.id)).records).toEqual(foreignBefore.records);
  });

  it('does not validate untouched required fields or apply their defaults', async () => {
    const table = await createTable(baseId, {
      name: 'temporary submitted fields only',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText, notNull: true },
        { name: 'Amount', type: FieldType.Number },
      ],
      records: [{ fields: { Title: 'unchanged', Amount: 7 } }],
    });
    tables.push(table.id);
    const before = await getRecords(table.id);
    const response = await preview(table.id, {
      projection: [table.fields[1].id],
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: '42',
    });
    expect(response.status, JSON.stringify(response.data)).toBe(200);
    expect(response.data).toEqual([{ fields: { [table.fields[1].id]: 42 } }]);
    expect((await getRecords(table.id)).records).toEqual(before.records);
  });

  it('rolls back new choices when later user resolution fails', async () => {
    const table = await createTable(baseId, {
      name: 'temporary late resolution rollback',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Choice', type: FieldType.SingleSelect, options: { choices: [] } },
        {
          name: 'Owner',
          type: FieldType.User,
          options: { isMultiple: false, shouldNotify: false },
        },
      ],
      records: [{ fields: { Title: 'unchanged' } }],
    });
    tables.push(table.id);
    const before = await getRecords(table.id);
    const choiceBefore = await getField(table.id, table.fields[1].id);
    const response = await preview(table.id, {
      projection: [table.fields[1].id, table.fields[2].id],
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [['must-roll-back', { id: `usr${'z'.repeat(16)}`, title: 'Missing collaborator' }]],
    });
    expect(response.status, JSON.stringify(response.data)).toBe(400);
    expect((await getField(table.id, table.fields[1].id)).options).toEqual(choiceBefore.options);
    expect((await getRecords(table.id)).records).toEqual(before.records);
  });

  it.each([FieldType.CreatedTime, FieldType.LastModifiedTime])(
    'formats computed timestamp array clipboard headers for %s',
    async (type) => {
      const table = await createTable(baseId, {
        name: 'temporary timestamp snapshot',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          {
            name: 'Clock',
            type,
            options: {
              formatting: { date: 'YYYY/MM/DD', time: 'HH:mm', timeZone: 'Asia/Singapore' },
            },
          },
        ],
        records: [{ fields: { Title: 'unchanged' } }],
      });
      tables.push(table.id);
      const link = await createField(table.id, {
        name: 'Clock source link',
        type: FieldType.Link,
        options: { foreignTableId: table.id, relationship: Relationship.ManyMany },
      });
      const header = await createField(table.id, {
        name: 'Copied timestamps',
        type,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table.id,
          linkFieldId: link.id,
          lookupFieldId: table.fields[1].id,
        },
      });
      const before = await getRecords(table.id);
      const response = await preview(table.id, {
        projection: [table.fields[0].id],
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [[['2023-06-19T06:50:48.017Z', '2023-06-20T06:50:48.017Z']]],
        header: [header],
      });
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      expect(response.data).toEqual([
        {
          fields: {
            [table.fields[0].id]: '2023/06/19 14:50, 2023/06/20 14:50',
          },
        },
      ]);
      expect((await getRecords(table.id)).records).toEqual(before.records);
    }
  );

  it.each([FieldType.Date, FieldType.CreatedTime, FieldType.LastModifiedTime, FieldType.Formula])(
    'formats scalar ISO timestamp clipboard values for %s',
    async (type) => {
      const table = await createTable(baseId, {
        name: 'temporary scalar timestamp',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          {
            name: 'Clock',
            type,
            options: {
              ...(type === FieldType.Formula ? { expression: 'CREATED_TIME()' } : {}),
              formatting: { date: 'YYYY/MM/DD', time: 'HH:mm', timeZone: 'Asia/Singapore' },
            },
          },
        ],
        records: [{ fields: { Title: 'unchanged' } }],
      });
      tables.push(table.id);
      const before = await getRecords(table.id);
      const response = await preview(table.id, {
        projection: [table.fields[0].id],
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['2023-06-19T06:50:48.017Z']],
        header: [table.fields[1]],
      });
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      expect(response.data).toEqual([{ fields: { [table.fields[0].id]: '2023/06/19 14:50' } }]);
      expect((await getRecords(table.id)).records).toEqual(before.records);
    }
  );

  it('preserves rendered datetime text in an actual mixed rich copy-to-preview roundtrip', async () => {
    const table = await createTable(baseId, {
      name: 'temporary rendered copy',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        {
          name: 'Clock',
          type: FieldType.Date,
          options: {
            formatting: { date: 'YYYY/MM/DD', time: 'HH:mm', timeZone: 'Asia/Singapore' },
          },
        },
        {
          name: 'Owner',
          type: FieldType.User,
          options: { isMultiple: false, shouldNotify: false },
        },
      ],
      records: [
        {
          fields: {
            Title: 'unchanged',
            Clock: '2023-06-19T06:50:48.017Z',
            Owner: { id: globalThis.testConfig.userId },
          },
        },
      ],
    });
    tables.push(table.id);
    const before = await getRecords(table.id);
    const copied = await axios.post(
      `/table/${table.id}/selection/copy-by-id`,
      {
        selection: {
          recordIds: [table.records[0].id],
          fieldIds: [table.fields[1].id, table.fields[2].id],
        },
      },
      { headers: { [X_CANARY_HEADER]: 'true' }, validateStatus: () => true }
    );
    expect(copied.status, JSON.stringify(copied.data)).toBe(201);
    expect(copied.data.rawContent).toEqual([
      ['2023/06/19 14:50', expect.objectContaining({ id: globalThis.testConfig.userId })],
    ]);
    const response = await preview(table.id, {
      projection: [table.fields[0].id],
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: copied.data.rawContent,
      header: copied.data.header,
    });
    expect(response.status, JSON.stringify(response.data)).toBe(200);
    expect(response.data).toEqual([{ fields: { [table.fields[0].id]: '2023/06/19 14:50' } }]);
    expect((await getRecords(table.id)).records).toEqual(before.records);
  });
});
