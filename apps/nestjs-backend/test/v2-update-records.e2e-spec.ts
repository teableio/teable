import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { updateRecordsOkResponseSchema } from '@teable/v2-contract-http';

import {
  convertField,
  createRecords,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('V2Controller updateRecords (e2e)', () => {
  let app: INestApplication;
  let appUrl: string;
  let cookie: string;

  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    appUrl = appCtx.appUrl;
    cookie = appCtx.cookie;
  });

  afterAll(async () => {
    await app.close();
  });

  const createFilterVariantTable = async (name: string) => {
    const table = await createTable(baseId, {
      name,
      fields: [
        { name: 'Title', type: FieldType.SingleLineText, isPrimary: true },
        { name: 'Amount', type: FieldType.Number },
        { name: 'Status', type: FieldType.SingleLineText },
      ],
    });

    const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
    const amountFieldId = table.fields.find((field) => field.name === 'Amount')?.id ?? '';
    const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';

    await createRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {
            [titleFieldId]: 'Alpha',
            [amountFieldId]: 2,
            [statusFieldId]: 'Open',
          },
        },
        {
          fields: {
            [titleFieldId]: 'Beta',
            [amountFieldId]: 8,
            [statusFieldId]: 'Open',
          },
        },
        {
          fields: {
            [titleFieldId]: 'Gamma',
            [amountFieldId]: 12,
            [statusFieldId]: 'Done',
          },
        },
        {
          fields: {
            [titleFieldId]: 'Delta',
            [amountFieldId]: 5,
            [statusFieldId]: 'InProgress',
          },
        },
      ],
    });

    return {
      table,
      titleFieldId,
      amountFieldId,
      statusFieldId,
    };
  };

  const getStatusByTitle = async (tableId: string, titleFieldId: string, statusFieldId: string) => {
    const records = await getRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      skip: 0,
      take: 100,
    });
    return new Map(
      records.records.map((record) => [record.fields[titleFieldId], record.fields[statusFieldId]])
    );
  };

  it('updates records through /api/v2/tables/updateRecords', async () => {
    const table = await createTable(baseId, {
      name: 'v2 update records',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText, isPrimary: true },
        { name: 'Amount', type: FieldType.Number },
        { name: 'Status', type: FieldType.SingleLineText },
      ],
    });

    try {
      const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
      const amountFieldId = table.fields.find((field) => field.name === 'Amount')?.id ?? '';
      const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';

      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [titleFieldId]: 'Alpha',
              [amountFieldId]: 1,
              [statusFieldId]: 'Open',
            },
          },
          {
            fields: {
              [titleFieldId]: 'Beta',
              [amountFieldId]: 8,
              [statusFieldId]: 'Open',
            },
          },
          {
            fields: {
              [titleFieldId]: 'Gamma',
              [amountFieldId]: 12,
              [statusFieldId]: 'Open',
            },
          },
        ],
      });

      const response = await fetch(`${appUrl}/api/v2/tables/updateRecords`, {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [statusFieldId]: 'Done',
          },
          filter: {
            fieldId: amountFieldId,
            operator: 'isGreater',
            value: 5,
          },
        }),
      });

      expect(response.status).toBe(200);

      const rawBody = await response.json();
      const parsed = updateRecordsOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.data.updatedCount).toBe(2);

      const records = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        skip: 0,
        take: 100,
      });
      const statusByTitle = new Map(
        records.records.map((record) => [record.fields[titleFieldId], record.fields[statusFieldId]])
      );

      expect(statusByTitle.get('Alpha')).toBe('Open');
      expect(statusByTitle.get('Beta')).toBe('Done');
      expect(statusByTitle.get('Gamma')).toBe('Done');
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it('updates records through /api/v2/tables/updateRecords with nested filter groups', async () => {
    const { table, titleFieldId, amountFieldId, statusFieldId } = await createFilterVariantTable(
      'v2 update records nested filters'
    );

    try {
      const response = await fetch(`${appUrl}/api/v2/tables/updateRecords`, {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [statusFieldId]: 'Escalated',
          },
          filter: {
            conjunction: 'or',
            items: [
              {
                fieldId: statusFieldId,
                operator: 'is',
                value: 'InProgress',
              },
              {
                conjunction: 'and',
                items: [
                  {
                    fieldId: amountFieldId,
                    operator: 'isGreater',
                    value: 10,
                  },
                  {
                    fieldId: titleFieldId,
                    operator: 'contains',
                    value: 'mm',
                  },
                ],
              },
            ],
          },
        }),
      });

      expect(response.status).toBe(200);

      const rawBody = await response.json();
      const parsed = updateRecordsOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.data.updatedCount).toBe(2);

      const statusByTitle = await getStatusByTitle(table.id, titleFieldId, statusFieldId);

      expect(statusByTitle.get('Alpha')).toBe('Open');
      expect(statusByTitle.get('Beta')).toBe('Open');
      expect(statusByTitle.get('Gamma')).toBe('Escalated');
      expect(statusByTitle.get('Delta')).toBe('Escalated');
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it('updates records through /api/v2/tables/updateRecords with negated filters', async () => {
    const { table, titleFieldId, statusFieldId } = await createFilterVariantTable(
      'v2 update records negated filter'
    );

    try {
      const response = await fetch(`${appUrl}/api/v2/tables/updateRecords`, {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [statusFieldId]: 'Queued',
          },
          filter: {
            not: {
              fieldId: statusFieldId,
              operator: 'is',
              value: 'Done',
            },
          },
        }),
      });

      expect(response.status).toBe(200);

      const rawBody = await response.json();
      const parsed = updateRecordsOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.data.updatedCount).toBe(3);

      const statusByTitle = await getStatusByTitle(table.id, titleFieldId, statusFieldId);

      expect(statusByTitle.get('Alpha')).toBe('Queued');
      expect(statusByTitle.get('Beta')).toBe('Queued');
      expect(statusByTitle.get('Gamma')).toBe('Done');
      expect(statusByTitle.get('Delta')).toBe('Queued');
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it('updates explicit recordIds through /api/v2/tables/updateRecords', async () => {
    const table = await createTable(baseId, {
      name: 'v2 update records by ids',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText, isPrimary: true },
        { name: 'Status', type: FieldType.SingleLineText },
      ],
    });

    try {
      const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
      const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';

      const created = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [titleFieldId]: 'Alpha',
              [statusFieldId]: 'Open',
            },
          },
          {
            fields: {
              [titleFieldId]: 'Beta',
              [statusFieldId]: 'Open',
            },
          },
          {
            fields: {
              [titleFieldId]: 'Gamma',
              [statusFieldId]: 'Open',
            },
          },
        ],
      });
      const records = created.records;

      const response = await fetch(`${appUrl}/api/v2/tables/updateRecords`, {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [statusFieldId]: 'Done',
          },
          recordIds: [records[0]!.id, records[2]!.id],
        }),
      });

      expect(response.status).toBe(200);

      const rawBody = await response.json();
      const parsed = updateRecordsOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.data.updatedCount).toBe(2);

      const refreshed = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        skip: 0,
        take: 100,
      });
      const statusByTitle = new Map(
        refreshed.records.map((record) => [
          record.fields[titleFieldId],
          record.fields[statusFieldId],
        ])
      );

      expect(statusByTitle.get('Alpha')).toBe('Done');
      expect(statusByTitle.get('Beta')).toBe('Open');
      expect(statusByTitle.get('Gamma')).toBe('Done');
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it('preserves omitted singleSelect values in sparse explicit batch updates', async () => {
    const table = await createTable(baseId, {
      name: 'v2 sparse update preserves omitted single select',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText, isPrimary: true },
        {
          name: 'Status',
          type: FieldType.SingleSelect,
          options: {
            choices: [{ name: 'Open' }, { name: 'Closed' }],
            preventAutoNewOptions: true,
          },
        },
        { name: 'Notes', type: FieldType.SingleLineText },
      ],
    });

    try {
      const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
      const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
      const notesFieldId = table.fields.find((field) => field.name === 'Notes')?.id ?? '';

      const created = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [titleFieldId]: 'Alpha',
              [statusFieldId]: 'Open',
            },
          },
          {
            fields: {
              [titleFieldId]: 'Beta',
              [statusFieldId]: 'Open',
            },
          },
        ],
      });

      const response = await fetch(`${appUrl}/api/v2/tables/updateRecords`, {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          tableId: table.id,
          fieldKeyType: FieldKeyType.Id,
          records: [
            {
              id: created.records[0]!.id,
              fields: {
                [notesFieldId]: 'Touched',
              },
            },
            {
              id: created.records[1]!.id,
              fields: {
                [statusFieldId]: 'Closed',
              },
            },
          ],
        }),
      });

      expect(response.status).toBe(200);

      const rawBody = await response.json();
      const parsed = updateRecordsOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.data.updatedCount).toBe(2);

      const refreshed = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        skip: 0,
        take: 100,
      });
      const recordsByTitle = new Map(
        refreshed.records.map((record) => [record.fields[titleFieldId], record])
      );

      expect(recordsByTitle.get('Alpha')?.fields[statusFieldId]).toBe('Open');
      expect(recordsByTitle.get('Alpha')?.fields[notesFieldId]).toBe('Touched');
      expect(recordsByTitle.get('Beta')?.fields[statusFieldId]).toBe('Closed');
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it('does not fail required singleSelect validation when omitted in another batch row', async () => {
    const table = await createTable(baseId, {
      name: 'v2 sparse update required single select',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText, isPrimary: true },
        {
          name: 'Status',
          type: FieldType.SingleSelect,
          options: {
            choices: [{ name: 'Open' }, { name: 'Closed' }],
            preventAutoNewOptions: true,
          },
        },
        { name: 'Notes', type: FieldType.SingleLineText },
      ],
    });

    try {
      const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
      const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
      const notesFieldId = table.fields.find((field) => field.name === 'Notes')?.id ?? '';
      const statusField = table.fields.find((field) => field.id === statusFieldId);

      if (!statusField) {
        throw new Error('Status field not found');
      }

      const initialRows = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        skip: 0,
        take: 100,
      });
      const primeResponse = await fetch(`${appUrl}/api/v2/tables/updateRecords`, {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          tableId: table.id,
          fieldKeyType: FieldKeyType.Id,
          fields: {
            [statusFieldId]: 'Open',
          },
          recordIds: initialRows.records.map((record) => record.id),
        }),
      });
      expect(primeResponse.status).toBe(200);

      await convertField(table.id, statusFieldId, {
        name: statusField.name,
        type: statusField.type,
        dbFieldName: statusField.dbFieldName,
        options: statusField.options,
        notNull: true,
      });

      const created = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [titleFieldId]: 'Alpha',
              [statusFieldId]: 'Open',
            },
          },
          {
            fields: {
              [titleFieldId]: 'Beta',
              [statusFieldId]: 'Open',
            },
          },
        ],
      });

      const response = await fetch(`${appUrl}/api/v2/tables/updateRecords`, {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          tableId: table.id,
          fieldKeyType: FieldKeyType.Id,
          records: [
            {
              id: created.records[0]!.id,
              fields: {
                [statusFieldId]: 'Closed',
              },
            },
            {
              id: created.records[1]!.id,
              fields: {
                [notesFieldId]: 'Still open',
              },
            },
          ],
        }),
      });

      expect(response.status).toBe(200);

      const rawBody = await response.json();
      const parsed = updateRecordsOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.data.updatedCount).toBe(2);

      const refreshed = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        skip: 0,
        take: 100,
      });
      const recordsByTitle = new Map(
        refreshed.records.map((record) => [record.fields[titleFieldId], record])
      );

      expect(recordsByTitle.get('Alpha')?.fields[statusFieldId]).toBe('Closed');
      expect(recordsByTitle.get('Beta')?.fields[statusFieldId]).toBe('Open');
      expect(recordsByTitle.get('Beta')?.fields[notesFieldId]).toBe('Still open');
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it('rejects empty filters through /api/v2/tables/updateRecords', async () => {
    const table = await createTable(baseId, {
      name: 'v2 update records empty filter',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText, isPrimary: true },
        { name: 'Status', type: FieldType.SingleLineText },
      ],
    });

    try {
      const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
      const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';

      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [titleFieldId]: 'Alpha',
              [statusFieldId]: 'Open',
            },
          },
          {
            fields: {
              [titleFieldId]: 'Beta',
              [statusFieldId]: 'Open',
            },
          },
        ],
      });

      const response = await fetch(`${appUrl}/api/v2/tables/updateRecords`, {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          tableId: table.id,
          fields: {
            [statusFieldId]: 'Done',
          },
          filter: {
            conjunction: 'and',
            items: [],
          },
        }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('filter.items'),
      });

      const records = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        skip: 0,
        take: 100,
      });
      const statusByTitle = new Map(
        records.records.map((record) => [record.fields[titleFieldId], record.fields[statusFieldId]])
      );

      expect(statusByTitle.get('Alpha')).toBe('Open');
      expect(statusByTitle.get('Beta')).toBe('Open');
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});
