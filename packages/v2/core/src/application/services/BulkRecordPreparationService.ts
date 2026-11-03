import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { OffsetPagination } from '../../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../../domain/shared/pagination/PageLimit';
import { PageOffset } from '../../domain/shared/pagination/PageOffset';
import { composeAndSpecsOrUndefined } from '../../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import type { RecordWriteSideEffects } from '../../domain/table/fields/visitors/RecordWriteSideEffectVisitor';
import type { RecordId } from '../../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../../domain/table/records/specs/RecordByIdsSpec';
import { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { RecordWriteFieldValues } from '../../ports/RecordWritePlugin';
import type {
  ITableRecordQueryRepository,
  ITableRecordQueryResult,
} from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import { v2CoreTokens } from '../../ports/tokens';
import type { RecordFilterNode } from '../../queries/RecordFilterDto';
import { buildRecordConditionSpec } from '../../queries/RecordFilterMapper';
import { FieldKeyResolverService } from './FieldKeyResolverService';
import { RecordWriteSideEffectService } from './RecordWriteSideEffectService';

export type BulkRecordConditionSpec = ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
export type BulkRecordResolvedUpdate = {
  readonly recordId: RecordId;
  readonly fieldValues: RecordWriteFieldValues;
};
export type BulkRecordAuthorizedUpdate = BulkRecordResolvedUpdate & {
  readonly currentRecord: TableRecordReadModel;
};
export type BulkRecordExplicitScope = {
  readonly authorizedUpdates: ReadonlyArray<BulkRecordAuthorizedUpdate>;
  readonly missingRecordIds: ReadonlyArray<RecordId>;
  readonly pluginFilteredRecordIds: ReadonlyArray<RecordId>;
};

/** An absent policy is not an unrestricted policy. Only a read-only host adapter may supply it. */
export type BulkRecordPreparedPolicy = {
  readonly recordSpec?: BulkRecordConditionSpec;
};
export interface IReadOnlyBulkRecordPolicy {
  prepare(
    context: IExecutionContext,
    input: {
      readonly operation: 'update' | 'delete';
      readonly table: Table;
      readonly recordIds?: ReadonlyArray<RecordId>;
      readonly fieldValues?: ReadonlyArray<ReadonlyMap<string, unknown>>;
      readonly typecast?: boolean;
    }
  ): Promise<Result<BulkRecordPreparedPolicy, DomainError>>;
}

export const resolveBulkRecordUpdates = (
  table: Table,
  updates: ReadonlyArray<BulkRecordResolvedUpdate>,
  fieldKeyType: FieldKeyType
): Result<ReadonlyArray<BulkRecordResolvedUpdate>, DomainError> => {
  const resolved: BulkRecordResolvedUpdate[] = [];
  for (const update of updates) {
    const fields = FieldKeyResolverService.resolveFieldKeys(
      table,
      Object.fromEntries(update.fieldValues),
      fieldKeyType
    );
    if (fields.isErr()) return err(fields.error);
    resolved.push({
      recordId: update.recordId,
      fieldValues: new Map(Object.entries(fields.value)),
    });
  }
  return ok(resolved);
};

/** Pure scope interpretation; execution and preview deliberately share missing/forbidden decisions. */
export const prepareBulkRecordExplicitScope = (
  table: Table,
  updates: ReadonlyArray<BulkRecordResolvedUpdate>,
  loaded: ITableRecordQueryResult,
  recordSpec?: BulkRecordConditionSpec
): Result<BulkRecordExplicitScope, DomainError> => {
  const currentRecords = new Map(loaded.records.map((record) => [record.id, record]));
  const authorizedUpdates: BulkRecordAuthorizedUpdate[] = [];
  const missingRecordIds: RecordId[] = [];
  const pluginFilteredRecordIds: RecordId[] = [];
  for (const update of updates) {
    const currentRecord = currentRecords.get(update.recordId.toString());
    if (!currentRecord) {
      missingRecordIds.push(update.recordId);
      continue;
    }
    if (recordSpec) {
      const record = TableRecord.fromRawFieldValues({
        id: currentRecord.id,
        tableId: table.id(),
        fields: currentRecord.fields,
      });
      if (record.isErr()) return err(record.error);
      if (!recordSpec.isSatisfiedBy(record.value)) {
        pluginFilteredRecordIds.push(update.recordId);
        continue;
      }
    }
    authorizedUpdates.push({ ...update, currentRecord });
  }
  return ok({ authorizedUpdates, missingRecordIds, pluginFilteredRecordIds });
};

export const prepareBulkRecordSelector = (
  table: Table,
  input: { readonly recordIds?: ReadonlyArray<RecordId>; readonly filter?: RecordFilterNode },
  recordSpec?: BulkRecordConditionSpec
): Result<
  { readonly baseSpec: BulkRecordConditionSpec; readonly scopedSpec: BulkRecordConditionSpec },
  DomainError
> => {
  const base = input.recordIds
    ? ok(RecordByIdsSpec.create(input.recordIds))
    : buildRecordConditionSpec(table, input.filter!);
  return base.map((baseSpec) => ({
    baseSpec,
    scopedSpec:
      composeAndSpecsOrUndefined([baseSpec, ...(recordSpec ? [recordSpec] : [])]) ?? baseSpec,
  }));
};

export const loadBulkRecordExplicitScope = async (
  context: IExecutionContext,
  table: Table,
  recordIds: ReadonlyArray<RecordId>,
  repository: ITableRecordQueryRepository,
  includeOrders = false
): Promise<Result<ITableRecordQueryResult, DomainError>> =>
  repository.find(context, table, RecordByIdsSpec.create(recordIds), {
    mode: 'stored',
    includeOrders,
    includeTotal: false,
  });

export type BulkRecordPreparationFacts = {
  readonly requestedCount: number | null;
  readonly loadedCount: number;
  readonly selectedCount: number;
  readonly authorizedCount: number | null;
  readonly acceptedCount: number | null;
  readonly missingCount: number | null;
  readonly pluginFilteredCount: number | null;
  readonly affectedCount: number | null;
  readonly schemaEffects: RecordWriteSideEffects;
  readonly policyChecked: boolean;
};

/** Data-only read preparation. No write plugin hook is reachable from this seam. */
@injectable()
export class BulkRecordPreparationService {
  constructor(
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly repository: ITableRecordQueryRepository,
    @inject(v2CoreTokens.recordWriteSideEffectService)
    private readonly sideEffects: RecordWriteSideEffectService
  ) {}

  async update(
    context: IExecutionContext,
    table: Table,
    input: {
      readonly records?: ReadonlyArray<BulkRecordResolvedUpdate>;
      readonly recordIds?: ReadonlyArray<RecordId>;
      readonly fieldValues: ReadonlyMap<string, unknown>;
      readonly filter?: RecordFilterNode;
      readonly fieldKeyType: FieldKeyType;
      readonly typecast: boolean;
      readonly hasOrder: boolean;
    },
    policy: BulkRecordPreparedPolicy | undefined
  ): Promise<Result<BulkRecordPreparationFacts, DomainError>> {
    const service = this;
    return safeTry(async function* () {
      if (input.records) {
        const resolved = yield* resolveBulkRecordUpdates(table, input.records, input.fieldKeyType);
        const loaded = yield* await loadBulkRecordExplicitScope(
          context,
          table,
          resolved.map((update) => update.recordId),
          service.repository
        );
        const scope = yield* prepareBulkRecordExplicitScope(
          table,
          resolved,
          loaded,
          policy?.recordSpec
        );
        const values = scope.authorizedUpdates.map((update) => new Map(update.fieldValues));
        const projection = policy
          ? yield* service.sideEffects.execute(context, table, values, input.typecast)
          : undefined;
        // Value equality and SQL mutation resolution can diverge (links, decorators, order).
        // Only a genuinely empty accepted write can be called an exact no-op here.
        const noAssignments = values.every((fields) => fields.size === 0) && !input.hasOrder;
        return ok({
          requestedCount: resolved.length,
          loadedCount: loaded.records.length,
          selectedCount: loaded.records.length,
          authorizedCount: policy ? scope.authorizedUpdates.length : null,
          acceptedCount: policy ? scope.authorizedUpdates.length : null,
          missingCount: scope.missingRecordIds.length,
          pluginFilteredCount: policy ? scope.pluginFilteredRecordIds.length : null,
          affectedCount:
            policy && (scope.authorizedUpdates.length === 0 || noAssignments) ? 0 : null,
          schemaEffects: projection?.effects ?? [],
          policyChecked: policy !== undefined,
        });
      }
      const selector = yield* prepareBulkRecordSelector(table, input, policy?.recordSpec);
      const pagination = yield* PageLimit.create(1).map((limit) =>
        OffsetPagination.create(limit, PageOffset.zero())
      );
      const selected = yield* await service.repository.find(context, table, selector.baseSpec, {
        mode: 'stored',
        includeTotal: true,
        idsOnly: true,
        ...(input.recordIds ? {} : { pagination }),
      });
      const authorized = policy
        ? policy.recordSpec
          ? yield* await service.repository.find(context, table, selector.scopedSpec, {
              mode: 'stored',
              includeTotal: true,
              idsOnly: true,
              pagination,
            })
          : selected
        : undefined;
      const resolved = yield* FieldKeyResolverService.resolveFieldKeys(
        table,
        Object.fromEntries(input.fieldValues),
        input.fieldKeyType
      );
      const values = new Map(Object.entries(resolved));
      const projection =
        authorized && authorized.total > 0
          ? yield* service.sideEffects.execute(context, table, [new Map(values)], input.typecast)
          : undefined;
      const existingIds = new Set(selected.records.map((record) => record.id));
      return ok({
        requestedCount: input.recordIds?.length ?? null,
        loadedCount: selected.records.length,
        selectedCount: selected.total,
        authorizedCount: authorized?.total ?? null,
        acceptedCount: authorized?.total ?? null,
        missingCount: input.recordIds
          ? input.recordIds.filter((id) => !existingIds.has(id.toString())).length
          : null,
        pluginFilteredCount: authorized ? selected.total - authorized.total : null,
        affectedCount: authorized?.total === 0 || (authorized && values.size === 0) ? 0 : null,
        schemaEffects: projection?.effects ?? [],
        policyChecked: policy !== undefined,
      });
    });
  }

  async delete(
    context: IExecutionContext,
    table: Table,
    recordIds: ReadonlyArray<RecordId>,
    policy: BulkRecordPreparedPolicy | undefined
  ): Promise<Result<BulkRecordPreparationFacts, DomainError>> {
    const loaded = await loadBulkRecordExplicitScope(context, table, recordIds, this.repository);
    if (loaded.isErr()) return err(loaded.error);
    const scope = prepareBulkRecordExplicitScope(
      table,
      recordIds.map((recordId) => ({ recordId, fieldValues: new Map() })),
      loaded.value,
      policy?.recordSpec
    );
    return scope.map((prepared) => ({
      requestedCount: recordIds.length,
      loadedCount: loaded.value.records.length,
      selectedCount: loaded.value.records.length,
      authorizedCount: policy ? prepared.authorizedUpdates.length : null,
      acceptedCount: policy ? prepared.authorizedUpdates.length : null,
      missingCount: prepared.missingRecordIds.length,
      pluginFilteredCount: policy ? prepared.pluginFilteredRecordIds.length : null,
      affectedCount: policy ? prepared.authorizedUpdates.length : null,
      schemaEffects: [],
      policyChecked: policy !== undefined,
    }));
  }
}
