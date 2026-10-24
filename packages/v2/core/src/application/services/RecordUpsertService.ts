import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { checkFieldUniqueValidationEnabled } from '../../commands/FieldValidation';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Field } from '../../domain/table/fields/Field';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import { RecordId } from '../../domain/table/records/RecordId';
import { RecordMutationSpecBuilder } from '../../domain/table/records/RecordMutationSpecBuilder';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordConditionSpecBuilder } from '../../domain/table/records/specs/RecordConditionSpecBuilder';
import { RecordConditionLiteralValue } from '../../domain/table/records/specs/RecordConditionValues';
import { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import { domainWrite, type IDomainWriteTransaction } from '../../ports/DomainWriteTransaction';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import {
  RecordQueryOperationKind,
  type RecordQueryPluginScope,
} from '../../ports/RecordQueryPlugin';
import {
  RecordWriteOperationKind,
  type RecordWriteFieldValues,
  type RecordWritePluginRunnerOptions,
} from '../../ports/RecordWritePlugin';
import type {
  ITableRecordQueryRepository,
  ITableRecordQueryResult,
} from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import { v2CoreTokens } from '../../ports/tokens';
import { composeUndoRedoCommands, type UndoRedoCommandLeafData } from '../../ports/UndoRedoStore';
import { FieldKeyResolverService } from './FieldKeyResolverService';
import {
  RecordBatchCreationService,
  type IRecordBatchCreationResult,
} from './RecordBatchCreationService';
import { RecordBulkUpdateService } from './RecordBulkUpdateService';
import { RecordQueryPluginRunner } from './RecordQueryPluginRunner';
import type { RecordWritePluginRunner } from './RecordWritePluginRunner';
import { TableQueryService } from './TableQueryService';
import { toUndoRedoStackAppendContext, UndoRedoStackService } from './UndoRedoStackService';

export const recordUpsertOnConflictValues = ['error', 'ignore', 'update'] as const;
export type RecordUpsertOnConflict = (typeof recordUpsertOnConflictValues)[number];

export const recordUpsertRowStatusValues = ['created', 'updated', 'unchanged', 'skipped'] as const;
export type RecordUpsertRowStatus = (typeof recordUpsertRowStatusValues)[number];

export interface IRecordUpsertRowResult {
  readonly index: number;
  readonly status: RecordUpsertRowStatus;
  readonly recordId?: string;
  readonly record?: TableRecord;
}

export interface IRecordUpsertInput {
  readonly table: Table;
  readonly recordsFieldValues: ReadonlyArray<RecordWriteFieldValues>;
  readonly matchFieldId: string;
  readonly onConflict: RecordUpsertOnConflict;
  readonly fieldKeyType: FieldKeyType;
  readonly typecast: boolean;
  readonly recordWritePluginRunnerOptions?: RecordWritePluginRunnerOptions;
}

export interface IRecordUpsertResult {
  readonly results: ReadonlyArray<IRecordUpsertRowResult>;
  readonly events: ReadonlyArray<IDomainEvent>;
}

type NormalizedMatchValue = {
  readonly key: string;
  readonly value: string | number;
};

type RowOutcome = {
  readonly status: RecordUpsertRowStatus;
  readonly recordId?: string;
  readonly record?: TableRecord;
};

type UpdateTarget = {
  readonly index: number;
  readonly recordId: RecordId;
  readonly fieldValues: ReadonlyMap<string, unknown>;
  /** Stored row image used as the response fallback and for read-scope checks. */
  readonly record: TableRecord;
};

type UpsertPlan = {
  readonly outcomes: ReadonlyArray<RowOutcome>;
  readonly events: ReadonlyArray<IDomainEvent>;
  readonly undoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly redoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly afterCommitHandlers: ReadonlyArray<() => Promise<void>>;
};

type UpsertCommitted = {
  readonly results: ReadonlyArray<IRecordUpsertRowResult>;
  readonly plan: UpsertPlan;
};

/** A unique-violation retry is cheap; the third conflict is surfaced to the caller. */
const MAX_CREATE_RETRIES = 2;

const resolveMatchField = (table: Table, matchFieldId: string): Result<Field, DomainError> => {
  return FieldId.create(matchFieldId).andThen((fieldId) =>
    table
      .getField((field) => field.id().equals(fieldId))
      .mapErr(() =>
        domainError.notFound({
          code: 'record.upsert.match_field_not_found',
          message: `Upsert match field not found: ${matchFieldId}`,
        })
      )
  );
};

const validateMatchField = (field: Field): Result<Field, DomainError> => {
  if (!field.unique().toBoolean() || !checkFieldUniqueValidationEnabled(field.type().toString())) {
    return err(
      domainError.validation({
        code: 'record.upsert.match_field_not_unique',
        message: `Field "${field.name().toString()}" cannot be used as an upsert match field: it must be unique and support unique validation`,
        details: {
          fieldId: field.id().toString(),
          fieldType: field.type().toString(),
          unique: field.unique().toBoolean(),
        },
      })
    );
  }
  return ok(field);
};

const SYNTHETIC_MATCH_RECORD_ID = RecordId.create(`rec${'0'.repeat(16)}`)._unsafeUnwrap();

/**
 * Converts a request match value with the same field-aware conversion the write
 * path uses, so the match key equals what an insert would store. Date parsing is
 * timezone sensitive for date-only input: `Date.parse` treats it as UTC while the
 * write path interprets it in the field/system timezone.
 */
const toWritePathDateValue = (
  table: Table,
  field: Field,
  rawValue: unknown,
  typecast: boolean
): Result<string, DomainError> => {
  const builder = RecordMutationSpecBuilder.create().withTypecast(typecast);
  builder.set(field, rawValue);
  if (builder.hasErrors()) {
    return err(builder.getErrors()[0]!);
  }

  return builder.build().andThen((spec) =>
    TableRecord.create({
      id: SYNTHETIC_MATCH_RECORD_ID,
      tableId: table.id(),
      fieldValues: [],
    }).andThen((emptyRecord) =>
      spec.mutate(emptyRecord).andThen((record) => {
        const value = record.fields().get(field.id())?.toValue();
        if (value == null) {
          return err(
            domainError.validation({
              code: 'record.upsert.match_value_required',
              message: `Upsert match field "${field.name().toString()}" produced an empty date value`,
              details: { fieldId: field.id().toString() },
            })
          );
        }
        return ok(value instanceof Date ? value.toISOString() : String(value));
      })
    )
  );
};

/**
 * Field-type aware identity key. It must mirror the database unique index: the
 * same value typed differently (number `1` vs string `"1"`) has to collide, and
 * date values have to compare by instant rather than by string spelling.
 *
 * `convertDate` lets request values go through the write path first; stored values
 * already carry an explicit instant and skip it.
 */
const normalizeMatchValue = (
  field: Field,
  rawValue: unknown,
  convertDate?: (rawValue: unknown) => Result<string, DomainError>
): Result<NormalizedMatchValue, DomainError> => {
  const fieldType = field.type().toString();
  const reject = () =>
    err(
      domainError.validation({
        code: 'record.upsert.match_value_required',
        message: `Every upserted record must provide a non-empty value for match field "${field.name().toString()}"`,
        details: { fieldId: field.id().toString(), fieldType },
      })
    );

  if (rawValue == null) return reject();

  if (fieldType === 'number') {
    const numeric = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (!Number.isFinite(numeric)) return reject();
    return ok({ key: `n:${numeric}`, value: numeric });
  }

  if (fieldType === 'date') {
    const converted = convertDate ? convertDate(rawValue) : ok(rawValue);
    if (converted.isErr()) return err(converted.error);
    const dateValue = converted.value;
    const time = dateValue instanceof Date ? dateValue.getTime() : Date.parse(String(dateValue));
    if (!Number.isFinite(time)) return reject();
    return ok({ key: `d:${time}`, value: new Date(time).toISOString() });
  }

  if (typeof rawValue === 'object') return reject();
  const text = String(rawValue);
  if (text.length === 0) return reject();
  return ok({ key: `s:${text}`, value: text });
};

const isMatchFieldUniqueViolation = (error: DomainError, matchFieldId: string): boolean => {
  if (error.code !== 'validation.field.unique') {
    return false;
  }
  const violatedFieldId = error.details?.fieldId;
  // Constraint metadata may not resolve to a field; retrying is still the best
  // available recovery and the retry budget is bounded.
  return violatedFieldId == null || violatedFieldId === matchFieldId;
};

/**
 * Applies read scope to upsert row results after the write transaction committed.
 * A row outside the read row spec loses its `recordId` and `record`; readable rows
 * keep their id and only lose cells hidden by the field allow-list or masks.
 */
export const applyUpsertReadScope = (
  table: Table,
  results: ReadonlyArray<IRecordUpsertRowResult>,
  scope: RecordQueryPluginScope | undefined
): ReadonlyArray<IRecordUpsertRowResult> => {
  const scopeIsEmpty =
    !scope || (!scope.recordSpec && scope.readableFieldIds == null && !scope.fieldMasks?.length);
  if (scopeIsEmpty) {
    return results;
  }

  return results.map((row) => {
    if (row.record == null) {
      return row.recordId == null ? row : { index: row.index, status: row.status };
    }

    const record = row.record;
    if (scope.recordSpec && !scope.recordSpec.isSatisfiedBy(record)) {
      return { index: row.index, status: row.status };
    }

    const visibleFields = new Map(
      record
        .fields()
        .entries()
        .map((entry) => [entry.fieldId.toString(), entry.value.toValue()] as const)
    );
    let changed = false;
    for (const fieldId of [...visibleFields.keys()]) {
      if (scope.readableFieldIds != null && !scope.readableFieldIds.has(fieldId)) {
        visibleFields.delete(fieldId);
        changed = true;
      }
    }
    for (const mask of scope.fieldMasks ?? []) {
      if (visibleFields.has(mask.fieldId) && !mask.visibleWhen.isSatisfiedBy(record)) {
        visibleFields.delete(mask.fieldId);
        changed = true;
      }
    }
    if (!changed) {
      return row;
    }

    const rebuilt = TableRecord.fromRawFieldValues({
      id: record.id().toString(),
      tableId: table.id(),
      fields: Object.fromEntries(visibleFields),
    });
    // Fail closed: an unmappable masked record keeps its id but loses its cells.
    return rebuilt.isOk()
      ? { ...row, record: rebuilt.value }
      : { index: row.index, status: row.status };
  });
};

@injectable()
export class RecordUpsertService {
  constructor(
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordQueryRepository,
    @inject(v2CoreTokens.recordBatchCreationService)
    private readonly recordBatchCreationService: RecordBatchCreationService,
    @inject(v2CoreTokens.recordBulkUpdateService)
    private readonly recordBulkUpdateService: RecordBulkUpdateService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.domainWriteTransaction)
    private readonly domainWriteTransaction: IDomainWriteTransaction,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordQueryPluginRunner)
    private readonly recordQueryPluginRunner: RecordQueryPluginRunner
  ) {}

  async upsert(
    context: IExecutionContext,
    input: IRecordUpsertInput
  ): Promise<Result<IRecordUpsertResult, DomainError>> {
    const service = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured

    return safeTry<IRecordUpsertResult, DomainError>(async function* () {
      const matchField = yield* validateMatchField(
        yield* resolveMatchField(input.table, input.matchFieldId)
      );
      const matchFieldId = matchField.id().toString();
      const fieldKeyResolutionContext = FieldKeyResolverService.createResolutionContext(
        input.table,
        input.fieldKeyType
      );

      const resolvedRows: ReadonlyMap<string, unknown>[] = [];
      const matchValues: NormalizedMatchValue[] = [];
      const seenKeys = new Set<string>();

      for (const recordFieldValues of input.recordsFieldValues) {
        const resolvedFields = yield* FieldKeyResolverService.resolveFieldKeysWithContext(
          fieldKeyResolutionContext,
          Object.fromEntries(recordFieldValues)
        );
        const row = new Map(Object.entries(resolvedFields));
        const matchValue = yield* normalizeMatchValue(matchField, row.get(matchFieldId), (raw) =>
          toWritePathDateValue(input.table, matchField, raw, input.typecast)
        );
        if (seenKeys.has(matchValue.key)) {
          return err(
            domainError.validation({
              code: 'record.upsert.duplicate_key_in_batch',
              message: `Duplicate upsert match value in request for field "${matchField.name().toString()}"`,
              details: { fieldId: matchFieldId, value: matchValue.value },
            })
          );
        }
        seenKeys.add(matchValue.key);
        resolvedRows.push(row);
        matchValues.push(matchValue);
      }

      const pluginExecution = yield* await service.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.upsertRecords,
        executionContext: context,
        table: input.table,
        payload: {
          recordsFieldValues: resolvedRows,
          matchFieldId,
          onConflict: input.onConflict,
          fieldKeyType: input.fieldKeyType,
          typecast: input.typecast,
          recordCount: resolvedRows.length,
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();
      const recordSpec = yield* pluginExecution.getRecordSpec();

      // Read scope is prepared separately from the write scope: it only decides
      // whether a row id/record may be returned, never whether it is writable.
      const readExecution = yield* await service.recordQueryPluginRunner.prepare({
        kind: RecordQueryOperationKind.getByIds,
        executionContext: context,
        table: input.table,
        payload: { recordIds: [] },
      });
      yield* await readExecution.guard();
      const readScope = yield* readExecution.getScope();

      const committed = yield* await service.domainWriteTransaction.execute<UpsertCommitted>(
        context,
        async (transactionContext) => {
          const planResult = await service.executeUpsert(
            transactionContext,
            input,
            matchField,
            resolvedRows,
            matchValues,
            recordSpec
          );
          if (planResult.isErr()) {
            return err(planResult.error);
          }
          const plan = planResult.value;
          return ok(
            domainWrite.fromEvents(
              {
                results: plan.outcomes.map((outcome, index) => ({
                  index,
                  ...outcome,
                })),
                plan,
              },
              plan.events,
              { tables: [input.table] }
            )
          );
        }
      );

      const { plan } = committed.value;
      const results = service.applyReadScope(input.table, committed.value.results, readScope);

      if (plan.undoCommands.length > 0 || plan.redoCommands.length > 0) {
        yield* await service.undoRedoStackService.appendEntry(
          toUndoRedoStackAppendContext(context),
          input.table.id(),
          {
            undoCommand: composeUndoRedoCommands(plan.undoCommands),
            redoCommand: composeUndoRedoCommands(plan.redoCommands),
          }
        );
      }

      await pluginExecution.afterCommit();
      for (const handler of plan.afterCommitHandlers) {
        await handler();
      }

      return ok({
        results,
        events: committed.events,
      });
    });
  }

  private async executeUpsert(
    context: IExecutionContext,
    input: IRecordUpsertInput,
    matchField: Field,
    resolvedRows: ReadonlyArray<ReadonlyMap<string, unknown>>,
    matchValues: ReadonlyArray<NormalizedMatchValue>,
    recordSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined
  ): Promise<Result<UpsertPlan, DomainError>> {
    const matchFieldId = matchField.id().toString();
    const outcomes = new Array<RowOutcome | undefined>(resolvedRows.length);
    const createdIds: string[] = [];
    const events: IDomainEvent[] = [];
    const undoCommands: UndoRedoCommandLeafData[] = [];
    const redoCommands: UndoRedoCommandLeafData[] = [];
    const afterCommitHandlers: Array<() => Promise<void>> = [];

    const initialMatch = await this.findMatchedRecords(
      context,
      input.table,
      matchField,
      matchValues
    );
    if (initialMatch.isErr()) {
      return err(initialMatch.error);
    }
    const matched = initialMatch.value;

    if (input.onConflict === 'error' && matched.size > 0) {
      return err(this.conflictError(input, matchField, matched));
    }

    const createIndexes: number[] = [];
    const updateTargets: UpdateTarget[] = [];

    for (let index = 0; index < resolvedRows.length; index += 1) {
      const matchedRecord = matched.get(matchValues[index]!.key);
      if (!matchedRecord) {
        createIndexes.push(index);
        continue;
      }

      const recordId = RecordId.create(matchedRecord.id);
      if (recordId.isErr()) {
        return err(recordId.error);
      }
      const matchedEntity = await this.toRecordEntity(input.table, matchedRecord);
      if (matchedEntity.isErr()) {
        return err(matchedEntity.error);
      }

      if (input.onConflict === 'ignore') {
        outcomes[index] = {
          status: 'skipped',
          recordId: matchedRecord.id,
          record: matchedEntity.value,
        };
        continue;
      }

      if (recordSpec && !recordSpec.isSatisfiedBy(matchedEntity.value)) {
        outcomes[index] = {
          status: 'skipped',
          recordId: matchedRecord.id,
          record: matchedEntity.value,
        };
        continue;
      }

      updateTargets.push({
        index,
        recordId: recordId.value,
        fieldValues: resolvedRows[index]!,
        record: matchedEntity.value,
      });
    }

    const appliedUpdates = await this.applyUpdates(
      context,
      input,
      updateTargets,
      outcomes,
      events,
      undoCommands,
      redoCommands,
      afterCommitHandlers
    );
    if (appliedUpdates.isErr()) {
      return err(appliedUpdates.error);
    }

    let pendingIndexes = createIndexes;
    let retries = 0;

    while (pendingIndexes.length > 0) {
      const pendingValues = pendingIndexes.map((index) => resolvedRows[index]!);
      const attempt = await this.domainWriteTransaction.savepoint(context, () =>
        this.createPendingRows(context, input.table.id(), pendingValues, input)
      );

      if (attempt.isOk()) {
        const creation = attempt.value;
        if (creation.records.length !== pendingIndexes.length) {
          return err(
            domainError.unexpected({
              code: 'record.upsert.created_count_mismatch',
              message: 'Upsert create results did not match the pending record count',
            })
          );
        }
        for (let offset = 0; offset < pendingIndexes.length; offset += 1) {
          const record = creation.records[offset]!;
          const recordId = record.id().toString();
          createdIds.push(recordId);
          outcomes[pendingIndexes[offset]!] = { status: 'created', recordId, record };
        }
        events.push(...creation.events);
        undoCommands.push(...creation.undoCommands);
        redoCommands.push(...creation.redoCommands);
        afterCommitHandlers.push(creation.afterCommit);
        break;
      }

      if (!isMatchFieldUniqueViolation(attempt.error, matchFieldId)) {
        return err(attempt.error);
      }

      retries += 1;
      if (retries > MAX_CREATE_RETRIES) {
        return err(attempt.error);
      }

      // The savepoint rolled back our inserts (and their snapshots/events/undo).
      // Re-read the keys and re-apply the conflict mode to the concurrent winner.
      const retryMatch = await this.findMatchedRecords(
        context,
        input.table,
        matchField,
        pendingIndexes.map((index) => matchValues[index]!)
      );
      if (retryMatch.isErr()) {
        return err(retryMatch.error);
      }
      if (input.onConflict === 'error' && retryMatch.value.size > 0) {
        return err(this.conflictError(input, matchField, retryMatch.value));
      }

      const remaining: number[] = [];
      const retryTargets: UpdateTarget[] = [];
      for (const index of pendingIndexes) {
        const matchedRecord = retryMatch.value.get(matchValues[index]!.key);
        if (!matchedRecord) {
          remaining.push(index);
          continue;
        }
        const recordId = RecordId.create(matchedRecord.id);
        if (recordId.isErr()) {
          return err(recordId.error);
        }
        const matchedEntity = await this.toRecordEntity(input.table, matchedRecord);
        if (matchedEntity.isErr()) {
          return err(matchedEntity.error);
        }
        if (input.onConflict === 'ignore') {
          outcomes[index] = {
            status: 'skipped',
            recordId: matchedRecord.id,
            record: matchedEntity.value,
          };
          continue;
        }
        if (recordSpec && !recordSpec.isSatisfiedBy(matchedEntity.value)) {
          outcomes[index] = {
            status: 'skipped',
            recordId: matchedRecord.id,
            record: matchedEntity.value,
          };
          continue;
        }
        retryTargets.push({
          index,
          recordId: recordId.value,
          fieldValues: resolvedRows[index]!,
          record: matchedEntity.value,
        });
      }

      const retryUpdates = await this.applyUpdates(
        context,
        input,
        retryTargets,
        outcomes,
        events,
        undoCommands,
        redoCommands,
        afterCommitHandlers
      );
      if (retryUpdates.isErr()) {
        return err(retryUpdates.error);
      }

      pendingIndexes = remaining;
    }

    const missing = outcomes.findIndex((outcome) => outcome == null);
    if (missing >= 0) {
      return err(
        domainError.unexpected({
          code: 'record.upsert.outcome_missing',
          message: `Upsert produced no outcome for record index ${missing}`,
        })
      );
    }

    return ok({
      outcomes: outcomes as ReadonlyArray<RowOutcome>,
      events,
      undoCommands,
      redoCommands,
      afterCommitHandlers,
    });
  }

  private async createPendingRows(
    context: IExecutionContext,
    tableId: TableId,
    pendingValues: ReadonlyArray<ReadonlyMap<string, unknown>>,
    input: IRecordUpsertInput
  ): Promise<Result<IRecordBatchCreationResult, DomainError>> {
    // A fresh aggregate per attempt: the failed attempt may have created select
    // options and buffered domain events that must not leak into the retry.
    const table = await this.tableQueryService.getById(context, tableId);
    if (table.isErr()) {
      return err(table.error);
    }

    return this.recordBatchCreationService.create(context, {
      table: table.value,
      recordsFieldValues: pendingValues,
      fieldKeyType: FieldKeyType.Id,
      typecast: input.typecast,
      isTransactionBound: true,
    });
  }

  private async applyUpdates(
    context: IExecutionContext,
    input: IRecordUpsertInput,
    targets: ReadonlyArray<UpdateTarget>,
    outcomes: Array<RowOutcome | undefined>,
    events: IDomainEvent[],
    undoCommands: UndoRedoCommandLeafData[],
    redoCommands: UndoRedoCommandLeafData[],
    afterCommitHandlers: Array<() => Promise<void>>
  ): Promise<Result<void, DomainError>> {
    if (targets.length === 0) {
      return ok(undefined);
    }

    const updateResult = await this.recordBulkUpdateService.updateWithinTransaction(context, {
      table: input.table,
      fieldValues: new Map(),
      filter: undefined,
      recordIds: undefined,
      records: targets.map((target) => ({
        recordId: target.recordId,
        fieldValues: target.fieldValues,
      })),
      typecast: input.typecast,
      fieldKeyType: FieldKeyType.Id,
      order: undefined,
      recordWritePluginRunnerOptions: input.recordWritePluginRunnerOptions,
    });
    if (updateResult.isErr()) {
      return err(updateResult.error);
    }

    const changed = new Set(updateResult.value.changedRecordIds.map((id) => id.toString()));
    const recordById = new Map(
      updateResult.value.records.map((record) => [record.id().toString(), record])
    );
    for (const target of targets) {
      const recordId = target.recordId.toString();
      outcomes[target.index] = {
        status: changed.has(recordId) ? 'updated' : 'unchanged',
        recordId,
        record: recordById.get(recordId) ?? target.record,
      };
    }

    events.push(...updateResult.value.events);
    undoCommands.push(...updateResult.value.undoCommands);
    redoCommands.push(...updateResult.value.redoCommands);
    afterCommitHandlers.push(updateResult.value.afterCommit);

    return ok(undefined);
  }

  private async findMatchedRecords(
    context: IExecutionContext,
    table: Table,
    matchField: Field,
    matchValues: ReadonlyArray<NormalizedMatchValue>
  ): Promise<Result<ReadonlyMap<string, TableRecordReadModel>, DomainError>> {
    if (matchValues.length === 0) {
      return ok(new Map());
    }

    const builder = RecordConditionSpecBuilder.create('or');
    for (const matchValue of matchValues) {
      const literal = RecordConditionLiteralValue.create(matchValue.value);
      if (literal.isErr()) {
        return err(literal.error);
      }
      builder.addCondition({ field: matchField, operator: 'is', value: literal.value });
    }

    const spec = builder.build();
    if (spec.isErr()) {
      return err(spec.error);
    }

    // Stored mode + no read scope: matching must see exactly what the unique index
    // sees, and writability is decided by the write plugin record spec below.
    const found = await this.tableRecordQueryRepository.find(context, table, spec.value, {
      mode: 'stored',
      includeTotal: false,
    });
    if (found.isErr()) {
      return err(found.error);
    }

    const matchFieldId = matchField.id().toString();
    const matched = new Map<string, TableRecordReadModel>();
    for (const record of (found.value as ITableRecordQueryResult).records) {
      const matchValue = normalizeMatchValue(matchField, record.fields[matchFieldId]);
      if (matchValue.isErr()) {
        continue;
      }
      if (!matched.has(matchValue.value.key)) {
        matched.set(matchValue.value.key, record);
      }
    }
    return ok(matched);
  }

  private toRecordEntity(
    table: Table,
    record: TableRecordReadModel
  ): Result<TableRecord, DomainError> {
    return TableRecord.fromRawFieldValues({
      id: record.id,
      tableId: table.id(),
      fields: record.fields,
    });
  }

  /**
   * Drops record ids/records the caller may not read. Write scope already decided
   * `updated` vs `skipped`; read scope never widens or narrows a write decision.
   */
  private applyReadScope(
    table: Table,
    results: ReadonlyArray<IRecordUpsertRowResult>,
    scope: RecordQueryPluginScope | undefined
  ): ReadonlyArray<IRecordUpsertRowResult> {
    return applyUpsertReadScope(table, results, scope);
  }
  private conflictError(
    input: IRecordUpsertInput,
    matchField: Field,
    matched: ReadonlyMap<string, TableRecordReadModel>
  ): DomainError {
    return domainError.conflict({
      code: 'record.upsert.conflict',
      message: `Upsert found ${matched.size} existing record(s) for match field "${matchField.name().toString()}" while onConflict is "error"`,
      details: {
        tableId: input.table.id().toString(),
        fieldId: matchField.id().toString(),
        conflictCount: matched.size,
      },
    });
  }
}
