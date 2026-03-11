/* eslint-disable @typescript-eslint/naming-convention */
import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 listRecords user field reference filter (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let nameFieldId: string;
  let ownerFieldId: string;
  let assigneesFieldId: string;

  const drainOutbox = async (rounds = 10) => {
    for (let i = 0; i < rounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const listRecordsWithFilter = async (filter: unknown) => {
    await drainOutbox();

    const params = new URLSearchParams({
      tableId,
      fieldKeyType: FieldKeyType.Id,
      filter: JSON.stringify(filter),
    });

    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });

    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`ListRecords failed: ${JSON.stringify(rawBody)}`);
    }

    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`ListRecords response invalid: ${JSON.stringify(rawBody)}`);
    }

    return parsed.data.data.records;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'User Field Reference Filter Table',
      fields: [
        { name: 'Name', type: 'singleLineText', isPrimary: true },
        {
          name: 'Owner',
          type: 'user',
          options: {
            isMultiple: false,
          },
        },
        {
          name: 'Assignees',
          type: 'user',
          options: {
            isMultiple: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    tableId = table.id;
    nameFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    ownerFieldId = table.fields.find((field) => field.name === 'Owner')?.id ?? '';
    assigneesFieldId = table.fields.find((field) => field.name === 'Assignees')?.id ?? '';

    const alice = { id: ctx.testUser.id, title: ctx.testUser.name };
    const bob = { id: 'usrRecordFilterFieldRefBob', title: 'Bob' };

    await sql`
      insert into users (id, name, email)
      values (${bob.id}, ${bob.title}, ${'bob+record-filter@e2e.com'})
      on conflict (id) do nothing
    `.execute(ctx.testContainer.db);

    await ctx.createRecords(tableId, [
      {
        fields: {
          [nameFieldId]: 'Alpha',
          [ownerFieldId]: alice,
          [assigneesFieldId]: [alice],
        },
      },
      {
        fields: {
          [nameFieldId]: 'Beta',
          [ownerFieldId]: alice,
          [assigneesFieldId]: [alice, bob],
        },
      },
      {
        fields: {
          [nameFieldId]: 'Gamma',
          [ownerFieldId]: bob,
          [assigneesFieldId]: [alice],
        },
      },
    ]);
  }, 30000);

  it('matches single user against multi user field reference', async () => {
    const records = await listRecordsWithFilter({
      fieldId: ownerFieldId,
      operator: 'is',
      value: {
        type: 'field',
        fieldId: assigneesFieldId,
      },
    });

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.fields[nameFieldId])).toEqual(['Alpha', 'Beta']);
  });

  it('matches multi user against single user field reference when multi has exactly one user', async () => {
    const records = await listRecordsWithFilter({
      fieldId: assigneesFieldId,
      operator: 'is',
      value: {
        type: 'field',
        fieldId: ownerFieldId,
      },
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.fields[nameFieldId]).toBe('Alpha');
  });
});
