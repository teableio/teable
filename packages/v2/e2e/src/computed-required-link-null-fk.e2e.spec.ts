/**
 * Required manyOne display columns are NOT NULL. Computed refresh used to assign
 * NULL when the FK was already empty, which 23502-dead-lettered the whole step
 * (including sibling manyMany title refresh). Preserve the existing display
 * value instead.
 *
 * Sanitized production shape: host table with required manyOne + manyMany to
 * the same foreign table; FK cleared while JSON remains; foreign title change
 * dirties the host via manyMany.
 */
import { sql } from 'kysely';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 computed required link with empty FK (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldSequence = 0;
  const cleanupTableIds: string[] = [];

  const createFieldId = (label: string) => {
    fieldSequence += 1;
    const suffix = `${label}${fieldSequence}`.replaceAll(/[^a-z0-9]/gi, '').slice(0, 16);
    return `fld${suffix.padEnd(16, '0')}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  afterEach(async () => {
    for (const tableId of [...cleanupTableIds].reverse()) {
      await ctx.deleteTable(tableId, { mode: 'permanent' }).catch(() => undefined);
    }
    cleanupTableIds.length = 0;
    await ctx.testContainer.dataDb
      .deleteFrom('computed_update_dead_letter')
      .where('base_id', '=', ctx.baseId)
      .execute()
      .catch(() => undefined);
  });

  it('refreshes manyMany titles without nulling a required manyOne display column', async () => {
    const foreignNameFieldId = createFieldId('foreignName');
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'required-link-null-fk-foreign',
      fields: [{ type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    cleanupTableIds.push(foreignTable.id);

    const linked = await ctx.createRecord(foreignTable.id, {
      [foreignNameFieldId]: 'Linked Title',
    });
    const other = await ctx.createRecord(foreignTable.id, {
      [foreignNameFieldId]: 'Other Title',
    });

    const hostNameFieldId = createFieldId('hostName');
    const requiredLinkFieldId = createFieldId('requiredLink');
    const manyManyFieldId = createFieldId('manyMany');
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'required-link-null-fk-host',
      fields: [
        { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
        {
          type: 'link',
          id: requiredLinkFieldId,
          name: 'Required Link',
          notNull: true,
          options: {
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignNameFieldId,
            isOneWay: true,
          },
        },
        {
          type: 'link',
          id: manyManyFieldId,
          name: 'Many Links',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignNameFieldId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    cleanupTableIds.push(hostTable.id);

    const hostRecord = await ctx.createRecord(hostTable.id, {
      [hostNameFieldId]: 'Host Row',
      [requiredLinkFieldId]: { id: linked.id },
      [manyManyFieldId]: [{ id: linked.id }, { id: other.id }],
    });
    await ctx.drainOutbox();

    const fkColumn = await sql<{ attname: string }>`
      SELECT a.attname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${ctx.baseId}
        AND c.relname = ${hostTable.id}
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attname LIKE ${'__fk_%'}
      ORDER BY a.attname
      LIMIT 1
    `.execute(ctx.testContainer.db);
    const fkName = fkColumn.rows.at(0)?.attname;
    expect(fkName).toBeTruthy();

    await sql`
      UPDATE ${sql.table(`${ctx.baseId}.${hostTable.id}`)}
      SET ${sql.id(fkName!)} = NULL
      WHERE __id = ${hostRecord.id}
    `.execute(ctx.testContainer.db);

    await ctx.updateRecord(foreignTable.id, other.id, {
      [foreignNameFieldId]: 'Other Title Updated',
    });
    await ctx.drainOutbox();

    const deadLetters = await ctx.testContainer.dataDb
      .selectFrom('computed_update_dead_letter')
      .select(['id', 'last_error', 'affected_table_ids', 'affected_field_ids'])
      .where('base_id', '=', ctx.baseId)
      .execute();
    const related = deadLetters.filter(
      (row) =>
        row.affected_table_ids.includes(hostTable.id) ||
        row.affected_field_ids.includes(requiredLinkFieldId) ||
        (row.last_error ?? '').includes('not-null')
    );
    expect(related).toEqual([]);

    const records = await ctx.listRecords(hostTable.id);
    const stored = records.find((item) => item.id === hostRecord.id);
    expect(stored).toBeDefined();

    const requiredValue = stored?.fields[requiredLinkFieldId] as
      | { id?: string; title?: string }
      | undefined;
    expect(requiredValue?.id ?? requiredValue).toBeTruthy();

    const manyManyValue = stored?.fields[manyManyFieldId] as
      | Array<{ id?: string; title?: string }>
      | undefined;
    const otherCell = (manyManyValue ?? []).find((item) => item.id === other.id);
    expect(otherCell?.title).toBe('Other Title Updated');
  });
});
