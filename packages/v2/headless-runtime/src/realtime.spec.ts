import {
  ActorId,
  buildRecordCollection,
  CreateBaseCommand,
  CreateRecordCommand,
  CreateTableCommand,
  CreateViewCommand,
  DeleteRecordsCommand,
  DeleteViewCommand,
  RenameViewCommand,
  UpdateRecordCommand,
  type CreateBaseResult,
  type CreateRecordResult,
  type CreateTableResult,
  type CreateViewResult,
  type DeleteRecordsResult,
  type DeleteViewResult,
  type RenameViewResult,
  type UpdateRecordResult,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { LocalRealtimeEngine } from './realtime';
import { createHeadlessRuntime } from './index';

const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.isErr()) {
    throw new Error(String(result.error));
  }
  return result.value;
};

const createContext = () => ({ actorId: unwrap(ActorId.create('usr_headless')) });

type ViewSnapshot = { id: string; name: string };
type CollectionUpdate = {
  snapshots: ReadonlyArray<ViewSnapshot>;
  removedDocIds: ReadonlyArray<string>;
};

describe('LocalRealtimeEngine view collections', () => {
  it('publishes view creates, updates, and deletes to collection subscribers', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });

    try {
      const context = createContext();
      const base = unwrap(
        await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
          context,
          unwrap(CreateBaseCommand.create({ name: 'Realtime views' }))
        )
      );
      const table = unwrap(
        await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
          context,
          unwrap(
            CreateTableCommand.create({
              baseId: base.base.id().toString(),
              name: 'Views',
              fields: [{ id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true }],
            })
          )
        )
      );
      const tableId = table.table.id().toString();
      await runtime.flushRealtime();

      const updates: CollectionUpdate[] = [];
      runtime.realtime.subscribeCollection(`viw_${tableId}`, (snapshots, removedDocIds) => {
        updates.push({ snapshots: snapshots as ReadonlyArray<ViewSnapshot>, removedDocIds });
      });

      const created = unwrap(
        await runtime.commandBus.execute<CreateViewCommand, CreateViewResult>(
          context,
          unwrap(CreateViewCommand.create({ tableId, view: { type: 'grid', name: 'Planning' } }))
        )
      );
      const viewId = created.viewId.toString();
      await runtime.flushRealtime();
      expect(updates.at(-1)?.snapshots).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: viewId, name: 'Planning' })])
      );

      unwrap(
        await runtime.commandBus.execute<RenameViewCommand, RenameViewResult>(
          context,
          unwrap(RenameViewCommand.create({ tableId, viewId, name: 'Renamed' }))
        )
      );
      await runtime.flushRealtime();
      expect(updates.at(-1)?.snapshots).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: viewId, name: 'Renamed' })])
      );

      unwrap(
        await runtime.commandBus.execute<DeleteViewCommand, DeleteViewResult>(
          context,
          unwrap(DeleteViewCommand.create({ tableId, viewId }))
        )
      );
      await runtime.flushRealtime();
      expect(updates.at(-1)?.snapshots).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: viewId })])
      );
      expect(updates.at(-1)?.removedDocIds).toEqual([viewId]);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('delivers record mutations through a supplied realtime engine', async () => {
    const realtime = new LocalRealtimeEngine();
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
      realtime,
    });

    try {
      const context = createContext();
      const base = unwrap(
        await runtime.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
          context,
          unwrap(CreateBaseCommand.create({ name: 'Custom realtime' }))
        )
      );
      const table = unwrap(
        await runtime.commandBus.execute<CreateTableCommand, CreateTableResult>(
          context,
          unwrap(
            CreateTableCommand.create({
              baseId: base.base.id().toString(),
              name: 'Records',
              fields: [{ id: 'fldName', name: 'Name', type: 'singleLineText', isPrimary: true }],
            })
          )
        )
      );
      const tableId = table.table.id().toString();
      const updates: CollectionUpdate[] = [];
      realtime.subscribeCollection(buildRecordCollection(tableId), (snapshots, removedDocIds) => {
        updates.push({ snapshots: snapshots as ReadonlyArray<ViewSnapshot>, removedDocIds });
      });
      const record = unwrap(
        await runtime.commandBus.execute<CreateRecordCommand, CreateRecordResult>(
          context,
          unwrap(
            CreateRecordCommand.create({
              tableId,
              fieldKeyType: 'id',
              fields: { fldName: 'Created' },
            })
          )
        )
      );
      const recordId = record.record.id().toString();
      await runtime.flushRealtime();
      expect(updates.at(-1)?.snapshots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: recordId,
            fields: expect.objectContaining({ fldName: 'Created' }),
          }),
        ])
      );

      unwrap(
        await runtime.commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
          context,
          unwrap(
            UpdateRecordCommand.create({
              tableId,
              recordId,
              fieldKeyType: 'id',
              fields: { fldName: 'Updated' },
            })
          )
        )
      );
      await runtime.flushRealtime();
      expect(updates.at(-1)?.snapshots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: recordId,
            fields: expect.objectContaining({ fldName: 'Updated' }),
          }),
        ])
      );

      unwrap(
        await runtime.commandBus.execute<DeleteRecordsCommand, DeleteRecordsResult>(
          context,
          unwrap(DeleteRecordsCommand.create({ tableId, recordIds: [recordId] }))
        )
      );
      await runtime.flushRealtime();
      expect(updates.at(-1)?.removedDocIds).toEqual([recordId]);
    } finally {
      await runtime.close();
    }
  }, 30_000);
});
