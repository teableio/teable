import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { createTableSchemaCoordinationLease } from '../../ports/TableSchemaCoordination';
import {
  exclusiveRecordWritePlan,
  preLeasePlan,
  sharedRecordWritePlan,
} from './RecordWriteCoordinationPlan';
import {
  assertRecordActorStorageEnabled,
  withRecordWriteCoordination,
} from './withRecordWriteCoordination';

const buildTable = (actorStorageVersion: number): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Actor capability gate')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  return Table.rehydrate({
    id: table.id(),
    baseId: table.baseId(),
    name: table.name(),
    fields: table.getFields(),
    primaryFieldId: table.primaryFieldId(),
    views: table.views(),
    actorStorageVersion,
  })._unsafeUnwrap();
};

const appContext: IExecutionContext = {
  actorId: ActorId.create('robot')._unsafeUnwrap(),
  initiator: { type: 'appUser', id: 'apu_verified' },
  requireActorStorage: true,
};

describe('record write actor capability gate', () => {
  it.each(['shared', 'exclusive', 'ordered'] as const)(
    'rejects enabled preflight followed by disabled actual %s metadata before mutation',
    async (mode) => {
      const enabled = buildTable(1);
      const disabled = buildTable(0);
      // The host checked its own earlier metadata. It is not the write lease's snapshot.
      expect(assertRecordActorStorageEnabled(appContext, enabled).isOk()).toBe(true);
      const events: string[] = [];
      let loads = 0;
      let persisted = false;
      const result = await withRecordWriteCoordination({
        context: appContext,
        tableId: disabled.id(),
        initialPlan: mode === 'ordered' ? preLeasePlan({ hasOrder: true }) : sharedRecordWritePlan,
        coordination: {
          acquire: async (_context, ids, leaseMode) => {
            events.push(`acquire:${leaseMode}`);
            return ok(
              createTableSchemaCoordinationLease(leaseMode, ids, async () => {
                events.push(`release:${leaseMode}`);
              })
            );
          },
        },
        loadTable: async () => {
          events.push('load');
          loads++;
          return ok(mode === 'exclusive' && loads === 1 ? enabled : disabled);
        },
        planForTable: () =>
          mode === 'exclusive' ? exclusiveRecordWritePlan : sharedRecordWritePlan,
        execute: async () => {
          persisted = true;
          return ok(undefined);
        },
      });
      expect(result._unsafeUnwrapErr().code).toBe('actor_storage.not_enabled');
      expect(persisted).toBe(false);
      expect(events).toEqual(
        mode === 'exclusive'
          ? [
              'acquire:shared',
              'load',
              'release:shared',
              'acquire:exclusive',
              'load',
              'release:exclusive',
            ]
          : ['acquire:shared', 'load', 'release:shared']
      );
    }
  );

  it.each([
    undefined,
    { type: 'user', id: 'usr_native' },
    { type: 'appUser', id: 'apu_verified' },
  ] as const)(
    'allows capability zero writes when the host does not require actor storage: %j',
    async (initiator) => {
      const legacy = buildTable(0);
      const context: IExecutionContext = { actorId: appContext.actorId, initiator };
      let leased = false;
      let mutations = 0;
      const result = await withRecordWriteCoordination({
        context,
        tableId: legacy.id(),
        initialPlan: sharedRecordWritePlan,
        coordination: {
          acquire: async (_context, ids, mode) => {
            leased = true;
            return ok(
              createTableSchemaCoordinationLease(mode, ids, async () => {
                leased = false;
              })
            );
          },
        },
        loadTable: async () => {
          expect(leased).toBe(true);
          return ok(legacy);
        },
        planForTable: () => sharedRecordWritePlan,
        execute: async (table) => {
          expect(leased).toBe(true);
          expect(table.actorStorageVersion()).toBe(0);
          mutations++;
          return ok('persisted');
        },
      });
      expect(result._unsafeUnwrap()).toBe('persisted');
      expect(mutations).toBe(1);
      expect(leased).toBe(false);
    }
  );

  it('allows required actor storage on enabled fresh metadata', async () => {
    const enabled = buildTable(1);
    const result = await withRecordWriteCoordination({
      context: appContext,
      tableId: enabled.id(),
      initialPlan: sharedRecordWritePlan,
      coordination: {
        acquire: async (_context, ids, mode) =>
          ok(createTableSchemaCoordinationLease(mode, ids, async () => undefined)),
      },
      loadTable: async () => ok(enabled),
      planForTable: () => sharedRecordWritePlan,
      execute: async (table) => ok(table.actorStorageVersion()),
    });
    expect(result._unsafeUnwrap()).toBe(1);
  });

  it.each([true, false, undefined])(
    'applies neutral host policy to the ordered fast path: %s',
    async (requireActorStorage) => {
      const table = buildTable(0);
      const events: string[] = [];
      const result = await withRecordWriteCoordination({
        context: { actorId: appContext.actorId, requireActorStorage },
        tableId: table.id(),
        initialPlan: preLeasePlan({ hasOrder: true }),
        coordination: {
          acquire: async (_context, ids, mode) => {
            events.push(`acquire:${mode}`);
            return ok(
              createTableSchemaCoordinationLease(mode, ids, async () => {
                events.push(`release:${mode}`);
              })
            );
          },
        },
        loadTable: async () => {
          events.push('load');
          return ok(table);
        },
        planForTable: () => sharedRecordWritePlan,
        execute: async () => {
          events.push('execute');
          return ok(undefined);
        },
      });
      expect(result.isErr()).toBe(requireActorStorage === true);
      expect(events).toEqual(
        requireActorStorage ? ['acquire:shared', 'load', 'release:shared'] : ['load', 'execute']
      );
    }
  );
});
