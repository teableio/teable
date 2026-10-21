/**
 * E2E tests for converting User field to SingleLineText.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: user → singleLineText conversion', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  // Two collaborators with a plain / comma-containing display name. User cell values only
  // resolve to collaborators of the table's base, and the stored title comes from the user row.
  const PLAIN_USER = { id: 'usrE2ePlainName', name: '张三' };
  const COMMA_USER = { id: 'usrE2eCommaName', name: '李,四' };

  const seedUser = async (user: { id: string; name: string }) => {
    await ctx.testContainer.db
      .insertInto('users')
      .values({ id: user.id, name: user.name, email: `${user.id}@e2e.com` })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
    await ctx.testContainer.db
      .insertInto('collaborator')
      .values({
        id: `col${user.id}`,
        resource_type: 'base',
        resource_id: ctx.baseId,
        principal_id: user.id,
        principal_type: 'user',
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'user to singleLineText conversion',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
    const primaryField = table.fields.find((f) => f.isPrimary);
    if (!primaryField) throw new Error('No primary field');
    primaryFieldId = primaryField.id;

    await seedUser(PLAIN_USER);
    await seedUser(COMMA_USER);
  });

  afterAll(async () => {
    if (!tableId) return;
    await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('should convert user to name/title', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'user',
        id: fieldId,
        name: 'User Field',
      },
    });
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: { id: 'system', title: 'System' },
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('System');

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle multiple users (isMultiple: true)', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'user',
        id: fieldId,
        name: 'Multiple User Field',
        options: { isMultiple: true },
      },
    });
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: [
        { id: 'system', title: 'System' },
        { id: 'usrTestUserId', title: 'Test User' },
      ],
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const records = await ctx.listRecords(tableId);
    const value = records.find((r) => r.id === r1.id)?.fields[fieldId];
    expect(typeof value).toBe('string');
    expect(value).toContain('System');

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should quote a comma-containing name for a multiple user field', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'user',
        id: fieldId,
        name: 'Multiple User Comma Field',
        options: { isMultiple: true },
      },
    });
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: [
        { id: PLAIN_USER.id, title: PLAIN_USER.name },
        { id: COMMA_USER.id, title: COMMA_USER.name },
      ],
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const records = await ctx.listRecords(tableId);
    // v1 parity: UserFieldCore.item2String quotes a title containing a comma when the source
    // field allows multiple users; items are joined with ', '.
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('张三, "李,四"');

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should not quote a comma-containing name for a single user field', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'user',
        id: fieldId,
        name: 'Single User Comma Field',
      },
    });
    const r1 = await ctx.createRecord(tableId, {
      [fieldId]: { id: COMMA_USER.id, title: COMMA_USER.name },
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('李,四');

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should handle null values', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'user',
        id: fieldId,
        name: 'Null User Field',
      },
    });
    const r1 = await ctx.createRecord(tableId, { [primaryFieldId]: 'No value' });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});
