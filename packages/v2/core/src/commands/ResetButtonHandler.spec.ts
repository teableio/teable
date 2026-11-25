import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import { ButtonResetCount } from '../domain/table/fields/types/ButtonResetCount';
import { ButtonWorkflow } from '../domain/table/fields/types/ButtonWorkflow';
import { Table } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import type { IButtonClickWorkflowService } from '../ports/ButtonClickWorkflowService';
import { NoopTableRecordQueryRepository } from '../ports/defaults/NoopTableRecordQueryRepository';
import { NoopTableRecordRepository } from '../ports/defaults/NoopTableRecordRepository';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { EventBusDomainWriteTransaction } from '../ports/memory/EventBusDomainWriteTransaction';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type { RecordActorAttribution } from '../ports/TableRecordRepository';
import type { IUnitOfWork, IUnitOfWorkOptions, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { ClickButtonCommand } from './ClickButtonCommand';
import { ClickButtonHandler } from './ClickButtonHandler';
import { createRecordWritePluginRunner } from './recordWritePluginRunnerTestUtils';
import { ResetButtonCommand } from './ResetButtonCommand';
import { ResetButtonHandler } from './ResetButtonHandler';
import { createNoopUndoRedoStackService } from './undoRedoStackServiceTestUtils';

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Reset actors')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .button()
    .withName(FieldName.create('Button')._unsafeUnwrap())
    .withResetCount(ButtonResetCount.create(true)._unsafeUnwrap())
    .withWorkflow(
      ButtonWorkflow.create({
        id: `wfl${'w'.repeat(16)}`,
        name: 'Run',
        isActive: true,
      })._unsafeUnwrap()
    )
    .done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  return Table.rehydrate({
    id: table.id(),
    baseId: table.baseId(),
    name: table.name(),
    fields: table.getFields(),
    views: table.views(),
    primaryFieldId: table.primaryFieldId(),
    dbTableName: table.dbTableName()._unsafeUnwrap(),
    actorStorageVersion: 1,
  })._unsafeUnwrap();
};

class TransactionUnitOfWork implements IUnitOfWork {
  committed = false;
  afterCommit?: () => void;

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    const result = await work({
      ...context,
      transaction: { kind: 'unitOfWorkTransaction', scope: options?.scope ?? 'data' },
    });
    if (result.isOk()) {
      this.committed = true;
      this.afterCommit?.();
    }
    return result;
  }
}

const eventBus: IEventBus = {
  publish: async () => ok(undefined),
  publishMany: async () => ok(undefined),
};

describe('Button mutation actor afterimages', () => {
  it.each([false, true])(
    'returns the transactional row actors when mutation=%s and never re-reads after commit',
    async (changed) => {
      const table = buildTable();
      const button = table.getFields().find((field) => field.type().toString() === 'button')!;
      const fieldId = button.id().toString();
      const recordId = `rec${'r'.repeat(16)}`;
      const context: IExecutionContext = {
        actorId: ActorId.create('system')._unsafeUnwrap(),
        initiator: { type: 'user', id: 'usr_reset' },
      };
      const originalActors: RecordActorAttribution = {
        createdByActorType: 'appUser',
        createdByActorId: 'apu_original',
        lastModifiedByActorType: 'automation',
        lastModifiedByActorId: 'workflow_original',
      };
      const persistedActors: RecordActorAttribution = {
        ...originalActors,
        lastModifiedByActorType: 'user',
        lastModifiedByActorId: 'usr_reset',
      };
      let stored: TableRecordReadModel = {
        id: recordId,
        version: 4,
        fields: { [fieldId]: changed ? { count: 3 } : null },
        ...originalActors,
      };
      const tables = new MemoryTableRepository();
      (await tables.insert(context, table))._unsafeUnwrap();
      const query = new NoopTableRecordQueryRepository();
      const unitOfWork = new TransactionUnitOfWork();
      const read = vi.spyOn(query, 'findOne').mockImplementation(async (transactionContext) => {
        expect(transactionContext.transaction?.scope).toBe('data');
        expect(unitOfWork.committed).toBe(false);
        return ok(stored);
      });
      unitOfWork.afterCommit = () => {
        stored = {
          ...stored,
          lastModifiedByActorType: 'system',
          lastModifiedByActorId: 'later_writer',
        };
      };
      const records = new NoopTableRecordRepository();
      const update = vi.spyOn(records, 'updateOne').mockResolvedValue(
        ok({
          mutationApplied: true,
          recordActors: persistedActors,
          updateSnapshot: {
            oldVersion: 4,
            newVersion: 5,
            previous: { recordId, fields: { [fieldId]: { count: 3 } } },
            current: { recordId, fields: { [fieldId]: null } },
          },
        })
      );
      const handler = new ResetButtonHandler(
        tables,
        records,
        query,
        createRecordWritePluginRunner(),
        createNoopUndoRedoStackService(),
        new EventBusDomainWriteTransaction(unitOfWork, eventBus)
      );

      const result = (
        await handler.handle(
          context,
          ResetButtonCommand.create({
            tableId: table.id().toString(),
            recordId,
            fieldId,
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap();

      expect(unitOfWork.committed).toBe(true);
      expect(result.recordActors).toEqual(changed ? persistedActors : originalActors);
      expect(result.record.fields().get(button.id())?.toValue()).toBeNull();
      expect(read).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledTimes(changed ? 1 : 0);
      expect(result.events).toHaveLength(changed ? 1 : 0);
    }
  );

  it('returns the click mutation actor image even when its workflow removes the row', async () => {
    const table = buildTable();
    const button = table.getFields().find((field) => field.type().toString() === 'button')!;
    const fieldId = button.id().toString();
    const recordId = `rec${'c'.repeat(16)}`;
    const context: IExecutionContext = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const actors: RecordActorAttribution = {
      createdByActorType: 'appUser',
      createdByActorId: 'apu_creator',
      lastModifiedByActorType: 'user',
      lastModifiedByActorId: 'usr_click',
    };
    const tables = new MemoryTableRepository();
    (await tables.insert(context, table))._unsafeUnwrap();
    const query = new NoopTableRecordQueryRepository();
    let removed = false;
    const read = vi
      .spyOn(query, 'findOne')
      .mockImplementation(async () =>
        removed
          ? err(domainError.notFound({ message: 'Removed by workflow' }))
          : ok({ id: recordId, version: 4, fields: { [fieldId]: null }, ...actors })
      );
    const records = new NoopTableRecordRepository();
    vi.spyOn(records, 'updateOne').mockResolvedValue(
      ok({
        mutationApplied: true,
        recordActors: actors,
        updateSnapshot: {
          oldVersion: 4,
          newVersion: 5,
          previous: { recordId, fields: { [fieldId]: null } },
          current: { recordId, fields: { [fieldId]: { count: 1 } } },
        },
      })
    );
    const unitOfWork = new TransactionUnitOfWork();
    const workflow: IButtonClickWorkflowService = {
      prepare: async () =>
        ok({
          filter: null,
          run: async () => {
            expect(unitOfWork.committed).toBe(true);
            removed = true;
            return ok({ runId: 'run_committed' });
          },
        }),
    };
    const handler = new ClickButtonHandler(
      tables,
      records,
      query,
      createRecordWritePluginRunner(),
      workflow,
      createNoopUndoRedoStackService(),
      new EventBusDomainWriteTransaction(unitOfWork, eventBus)
    );

    const result = (
      await handler.handle(
        context,
        ClickButtonCommand.create({
          tableId: table.id().toString(),
          recordId,
          fieldId,
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();

    expect(removed).toBe(true);
    expect(result.runId).toBe('run_committed');
    expect(result.recordActors).toEqual(actors);
    expect(read).toHaveBeenCalledOnce();
  });
});
