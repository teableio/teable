import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldOperationPluginRunner } from '../application/services/FieldOperationPluginRunner';
import { guardViewLinkFilterChanges } from '../application/services/guardViewLinkFilterChanges';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ViewOperationPluginRunner } from '../application/services/ViewOperationPluginRunner';
import { isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { LinkField } from '../domain/table/fields/types/LinkField';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { UpdateLinkConfigSpec } from '../domain/table/specs/field-updates/UpdateLinkConfigSpec';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { rehydrateViewSnapshot } from '../domain/table/views/ViewSnapshot';
import type { View } from '../domain/table/views/View';
import type { ViewId } from '../domain/table/views/ViewId';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TeableSpanAttributes } from '../ports/Tracer';
import { TraceSpan } from '../ports/TraceSpan';
import { ViewOperationKind, type ViewOperationPayloadViewConfig } from '../ports/ViewOperationPlugin';
import type { ClearedViewLinkFilters } from '../ports/UndoRedoStore';
import { ApplyViewSnapshotCommand } from './ApplyViewSnapshotCommand';
import { CommandHandler, type ICommandHandler } from './CommandHandler';

export class ApplyViewSnapshotResult {
  private constructor(readonly table: Table) {}

  static create(table: Table): ApplyViewSnapshotResult {
    return new ApplyViewSnapshotResult(table);
  }
}

@CommandHandler(ApplyViewSnapshotCommand)
@injectable()
export class ApplyViewSnapshotHandler implements ICommandHandler<
  ApplyViewSnapshotCommand,
  ApplyViewSnapshotResult
> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.viewOperationPluginRunner)
    private readonly viewOperationPluginRunner: ViewOperationPluginRunner,
    @inject(v2CoreTokens.fieldOperationPluginRunner)
    private readonly fieldOperationPluginRunner: FieldOperationPluginRunner
  ) {}

  @TraceSpan({
    attributes: (_context, command: ApplyViewSnapshotCommand) => ({
      [TeableSpanAttributes.TABLE_ID]: command.tableId.toString(),
      'teable.view_id': command.snapshot.id,
      'teable.undo_redo.command_type': 'ApplyViewSnapshot',
    }),
  })
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ApplyViewSnapshotCommand
  ): Promise<Result<ApplyViewSnapshotResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<ApplyViewSnapshotResult, DomainError>(async function* () {
      const tableSpec = yield* TableAggregate.specs().byId(command.tableId).build();
      const table = yield* await handler.tableRepository.findOne(context, tableSpec);
      const snapshotView = yield* rehydrateViewSnapshot(command.snapshot);
      const currentView = table.getView(snapshotView.id());
      const isRestore = currentView.isErr();
      const snapshotResult = yield* table.applyViewSnapshot(snapshotView);
      if (!snapshotResult.updateResult) {
        return ok(ApplyViewSnapshotResult.create(table));
      }
      // plugins must observe what the aggregate persists, not the raw undo entry
      const restoredView = yield* snapshotResult.updateResult.table.getView(snapshotView.id());
      const configFor = (view: View): Result<ViewOperationPayloadViewConfig, DomainError> => safeTry(function* () {
        const query = yield* view.queryDefaults();
        const order = view.order();
        return ok({ name: view.name().toString(), description: view.description(), isLocked: view.isLocked(),
          enableShare: view.enableShare(), shareId: view.shareId(), shareMeta: view.shareMeta(),
          ...(order.isOk() ? { order: order.value.toNumber() } : {}), columnMeta: (yield* view.columnMeta()).toDto(),
          filter: query.filter(), sort: query.sort(), group: query.group(), options: view.options() });
      });
      const restoredConfig = yield* configFor(restoredView);
      const previousConfig = currentView.isOk() ? yield* configFor(currentView.value) : undefined;
      const patch: ViewOperationPayloadViewConfig = previousConfig
        ? {
            // Authorize repaired visibility even when it matches the current layout,
            // without adding column updates to unrelated sharing-only replays.
            ...(JSON.stringify(restoredConfig.columnMeta) !==
            JSON.stringify(command.snapshot.columnMeta)
              ? { columnMeta: restoredConfig.columnMeta }
              : {}),
            ...Object.fromEntries(
              Object.entries(restoredConfig).filter(
                ([key, value]) =>
                  JSON.stringify(value) !==
                  JSON.stringify(previousConfig[key as keyof ViewOperationPayloadViewConfig])
              )
            ),
          }
        : restoredConfig;

      const pluginExecution = yield* await handler.viewOperationPluginRunner.prepare(
        isRestore
          ? {
              kind: ViewOperationKind.create,
              executionContext: context,
              payload: {
                tableId: table.id().toString(),
                currentViewCount: table.views().length,
                addedViewCount: 1,
                source: 'snapshotRestore',
                view: restoredConfig,
              },
              isTransactionBound: false,
            }
          : {
              kind: ViewOperationKind.update,
              executionContext: context,
              payload: {
                tableId: table.id().toString(),
                viewId: snapshotView.id().toString(),
                patch,
              },
              isTransactionBound: false,
            }
      );
      yield* await pluginExecution.guard();

      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        { table },
        () => ok(snapshotResult.updateResult!),
        isRestore && command.clearedLinkFilters.length
          ? {
              hooks: {
                afterPersist: (tx, restored) =>
                  handler.restoreLinkFilters(tx, restored, snapshotView.id(), command.clearedLinkFilters),
              },
            }
          : undefined
      );
      return ok(ApplyViewSnapshotResult.create(updateResult.table));
    });
  }

  private async restoreLinkFilters(
    context: ExecutionContextPort.IExecutionContext,
    restoredTable: Table,
    viewId: ViewId,
    groups: ReadonlyArray<ClearedViewLinkFilters>
  ): Promise<Result<{ table: Table; events: IDomainEvent[] }, DomainError>> {
    const handler = this;
    return safeTry<{ table: Table; events: IDomainEvent[] }, DomainError>(async function* () {
      const events: IDomainEvent[] = [];
      let table = restoredTable;
      for (const group of groups) {
        const ownerId = yield* TableId.create(group.tableId);
        const isSource = ownerId.equals(restoredTable.id());
        const spec = yield* TableAggregate.specs().byId(ownerId).build();
        // The source aggregate passed to this hook predates the write transaction.
        // Its Grid can still be provisioning while we read the committed link options.
        const loaded = await handler.tableRepository.findOne(context, spec, {
          lock: 'forUpdate',
          state: isSource ? 'activeWithPending' : 'active',
        });
        if (loaded.isErr()) {
          if (!isSource && isNotFoundError(loaded.error)) continue;
          return err(loaded.error);
        }
        const owner = loaded.value;
        if (isSource) table = owner;
        const changes: UpdateLinkConfigSpec[] = [];
        const requested = new Set(group.fieldIds);
        for (const field of owner.getFields((f): f is LinkField => f instanceof LinkField && requested.has(f.id().toString()))) {
          if (!field.foreignTableId().equals(restoredTable.id()) || field.filterByViewId()) continue;
          const config = yield* field.configDto();
          const next = yield* LinkFieldConfig.create({
            ...config,
            filterByViewId: viewId.toString(),
          });
          changes.push(UpdateLinkConfigSpec.create(field.id(), field.config(), next));
        }
        if (!changes.length) continue;
        const update = yield* owner.update((mutator) => mutator.applySpecs(changes));
        yield* await guardViewLinkFilterChanges(handler.fieldOperationPluginRunner, context, restoredTable, owner, update, 'restoreView');
        const result = yield* await handler.tableUpdateFlow.execute(
          context,
          { table: owner },
          () => ok(update),
          { publishEvents: false }
        );
        events.push(...result.events, ...result.postPersistEvents);
        if (isSource) table = result.table;
      }
      return ok({ table, events });
    });
  }
}
