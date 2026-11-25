import { FieldKeyType, FieldType, TableDomain } from '@teable/core';
import { plainToInstance } from 'class-transformer';
import knex from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { LastModifiedByFieldDto } from '../field/model/field-dto/last-modified-by-field.dto';
import { SingleLineTextFieldDto } from '../field/model/field-dto/single-line-text-field.dto';
import { SystemFieldService } from './system-field.service';

const selectedId = `fld${'a'.repeat(16)}`;
const unrelatedId = `fld${'b'.repeat(16)}`;
const modifierId = `fld${'c'.repeat(16)}`;
const executor = {
  id: 'usrExecutor',
  name: 'Platform executor',
  email: 'executor@example.invalid',
};

type Initiator = { type: 'user' | 'appUser' | 'automation' | 'system'; id: string } | undefined;

const fixture = (initiator: Initiator, actorStorageVersion: 0 | 1 = 1) => {
  const compiler = knex({ client: 'pg' });
  const execute = vi.fn(
    async (_tableId: string, _sql: string, _options: { useTransaction: boolean }) => undefined
  );
  const withTableWrite = vi.fn(
    async (_tableId: string, work: (table: { actorStorageVersion: 0 | 1 }) => Promise<unknown>) =>
      work({ actorStorageVersion })
  );
  const cls = {
    get: (key: string) =>
      key === 'user'
        ? executor
        : key === 'recordInitiator'
          ? initiator
          : key === 'tx.timeStr'
            ? '2026-11-15T00:00:00.000Z'
            : undefined,
  };
  const service = Reflect.construct(SystemFieldService, [
    cls,
    {},
    { executeDataPrismaForTable: execute },
    compiler,
    { withTableWrite },
  ]) as SystemFieldService;
  const table = new TableDomain({
    id: `tbl${'t'.repeat(16)}`,
    name: 'Business',
    dbTableName: 'base.Business',
    lastModifiedTime: '2026-11-15T00:00:00.000Z',
    actorStorageVersion,
    fields: [
      plainToInstance(SingleLineTextFieldDto, {
        id: selectedId,
        name: 'Selected',
        type: FieldType.SingleLineText,
        dbFieldName: 'selected',
      }),
      plainToInstance(SingleLineTextFieldDto, {
        id: unrelatedId,
        name: 'Unrelated',
        type: FieldType.SingleLineText,
        dbFieldName: 'unrelated',
      }),
      plainToInstance(LastModifiedByFieldDto, {
        id: modifierId,
        name: 'Modifier',
        type: FieldType.LastModifiedBy,
        dbFieldName: 'tracked_modifier',
        options: { trackedFieldIds: [selectedId] },
      }),
    ],
  });
  return { service, table, execute, withTableWrite };
};

describe('SystemFieldService initiator attribution', () => {
  it('stores the App initiator while keeping the executor native and updates only the tracked cell', async () => {
    const f = fixture({ type: 'appUser', id: 'apu_A' });
    const updated = await f.service.getModifiedSystemOpsMap(f.table, FieldKeyType.Id, [
      { id: 'recSelected', fields: { [selectedId]: 'changed' } },
      { id: 'recUnrelated', fields: { [unrelatedId]: 'changed' } },
    ]);
    expect(updated[0].fields[modifierId]).toEqual({ id: 'apu_A', title: 'apu_A' });
    expect(updated[1].fields).not.toHaveProperty(modifierId);
    const [nativeSql] = f.execute.mock.calls[0];
    expect(nativeSql).toBe(f.table.id);
    const rootSql = f.execute.mock.calls[0][1];
    expect(rootSql).toContain('"__last_modified_by" = \'usrExecutor\'');
    expect(rootSql).toContain('"__last_modified_by_actor_type" = \'appUser\'');
    expect(rootSql).toContain('"__last_modified_by_actor_id" = \'apu_A\'');
    const trackedSql = f.execute.mock.calls[1][1];
    expect(trackedSql).toContain('tracked_modifier');
    expect(trackedSql).toContain('apu_A');
    expect(trackedSql).toContain('recSelected');
    expect(trackedSql).not.toContain('recUnrelated');
    expect(trackedSql).not.toContain(executor.email);
    expect(f.execute.mock.calls.every((call) => call[2]?.useTransaction === true)).toBe(true);
    expect(f.withTableWrite).toHaveBeenCalledWith(f.table.id, expect.any(Function));
  });

  it.each([
    { type: 'user' as const, id: executor.id },
    { type: 'automation' as const, id: 'automationJob' },
    { type: 'system' as const, id: 'systemOperation' },
    undefined,
  ])('retains platform User-cell presentation for non-App initiator %s', async (initiator) => {
    const f = fixture(initiator);
    const result = await f.service.getModifiedSystemOpsMap(f.table, FieldKeyType.Id, [
      { id: 'recSelected', fields: { [selectedId]: 'changed' } },
    ]);
    expect(result[0].fields[modifierId]).toMatchObject({
      id: executor.id,
      title: executor.name,
      email: executor.email,
    });
    expect(f.execute.mock.calls[0][1]).toContain(initiator?.id ?? 'NULL');
    expect(f.execute.mock.calls[1][1]).not.toContain('automationJob');
  });

  it('stores a different platform initiator without borrowing the executor profile', async () => {
    const f = fixture({ type: 'user', id: 'usrInitiator' });
    const result = await f.service.getModifiedSystemOpsMap(f.table, FieldKeyType.Id, [
      { id: 'recSelected', fields: { [selectedId]: 'changed' } },
    ]);
    expect(result[0].fields[modifierId]).toEqual({ id: 'usrInitiator', title: 'usrInitiator' });
    expect(f.execute.mock.calls[0][1]).toContain('usrInitiator');
    expect(f.execute.mock.calls[1][1]).not.toContain(executor.email);
  });

  it('does not reference actor columns before the table capability is enabled', async () => {
    const f = fixture({ type: 'appUser', id: 'apu_A' }, 0);
    await f.service.getModifiedSystemOpsMap(f.table, FieldKeyType.Id, [
      { id: 'recSelected', fields: { [selectedId]: 'changed' } },
    ]);
    expect(f.execute.mock.calls[0][1]).not.toContain('_actor_');
  });
});
