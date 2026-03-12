import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { FieldUpdated, serializeFieldUpdatedValue } from '../../domain/table/events/FieldUpdated';
import { Table } from '../../domain/table/Table';
import type { IEventHandler } from '../../ports/EventHandler';
import type { RealtimeChange } from '../../ports/RealtimeChange';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as TableMapperPort from '../../ports/mappers/TableMapper';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { buildFieldShapeRefreshChanges } from './FieldRealtimeShapeRefresh';
import { ProjectionHandler } from './Projection';

const fieldCollectionPrefix = 'fld';

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const getValueAtPath = (value: unknown, path: ReadonlyArray<string>): unknown => {
  let current = value;
  for (const segment of path) {
    if (!(current instanceof Object) || !hasOwn(current, segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const buildFieldRealtimeChanges = (
  fieldDto: TableMapperPort.ITableFieldPersistenceDTO,
  event: FieldUpdated
): RealtimeChange[] => {
  const fieldChanges: RealtimeChange[] = [];
  const seenPaths = new Set<string>();

  for (const property of event.updatedProperties) {
    const change = event.changes[property];
    const path = event.realtimePathFor(property);
    const pathKey = JSON.stringify(path);
    if (seenPaths.has(pathKey)) {
      continue;
    }
    seenPaths.add(pathKey);

    const snapshotValue = getValueAtPath(fieldDto, path);
    const nextValue =
      snapshotValue === undefined ? serializeFieldUpdatedValue(change?.newValue) : snapshotValue;
    if (nextValue === undefined) {
      continue;
    }

    const canReuseOldValue = path.length === 1 && path[0] === property;
    const oldValue = canReuseOldValue ? serializeFieldUpdatedValue(change?.oldValue) : undefined;

    fieldChanges.push({
      type: 'set',
      path: [...path],
      value: nextValue,
      ...(oldValue === undefined ? {} : { oldValue }),
    });
  }

  fieldChanges.push(...buildFieldShapeRefreshChanges(fieldDto, event, seenPaths));

  return fieldChanges;
};

@ProjectionHandler(FieldUpdated)
@injectable()
export class FieldUpdatedRealtimeProjection implements IEventHandler<FieldUpdated> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: TableMapperPort.ITableMapper
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: FieldUpdated
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine, tableRepository, tableMapper } = this;

    return safeTry(async function* () {
      const spec = yield* Table.specs(event.baseId).byId(event.tableId).build().safeUnwrap();
      const table = yield* (await tableRepository.findOne(context, spec)).safeUnwrap();
      const snapshot = yield* tableMapper.toDTO(table).safeUnwrap();

      const fieldDto = snapshot.fields.find((field) => field.id === event.fieldId.toString());
      if (!fieldDto) {
        return ok(undefined);
      }

      const fieldCollection = `${fieldCollectionPrefix}_${event.tableId.toString()}`;
      const fieldDocId = yield* RealtimeDocId.fromParts(
        fieldCollection,
        event.fieldId.toString()
      ).safeUnwrap();

      const fieldChanges = buildFieldRealtimeChanges(fieldDto, event);

      if (fieldChanges.length === 0) {
        return ok(undefined);
      }

      return realtimeEngine.applyChange(context, fieldDocId, fieldChanges, {
        version: event.oldVersion,
      });
    });
  }
}
