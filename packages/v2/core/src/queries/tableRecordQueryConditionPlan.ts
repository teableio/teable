import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldCondition } from '../domain/table/fields/types/FieldCondition';
import type { LinkField } from '../domain/table/fields/types/LinkField';
import { RecordId } from '../domain/table/records/RecordId';
import { IncomingLinkCandidateSpec } from '../domain/table/records/specs/IncomingLinkCandidateSpec';
import { IncomingLinkSelectedSpec } from '../domain/table/records/specs/IncomingLinkSelectedSpec';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { RecordConditionSpecBuilder } from '../domain/table/records/specs/RecordConditionSpecBuilder';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { TableByIncomingReferenceToTableSpec } from '../domain/table/specs/TableByIncomingReferenceToTableSpec';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ILogger } from '../ports/Logger';
import type { RecordQueryFieldMask } from '../ports/RecordQueryPlugin';
import type { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import type { ITableRepository } from '../ports/TableRepository';
import { buildRecordConditionSpec } from './RecordFilterMapper';
import type { RecordFilter } from './RecordFilterDto';

export type IncomingLinkSelection = string | [string, string];

export type TableRecordQueryConditionPlanDeps = {
  readonly tableRepository: ITableRepository;
  readonly tableRecordQueryRepository: ITableRecordQueryRepository;
  readonly logger: ILogger;
};

export type TableRecordLinkCandidatePlan = {
  readonly candidateSpec?: IncomingLinkCandidateSpec;
  readonly linkFilterSpec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | null;
  readonly filterByViewId?: string;
};

export type TableRecordConditionPlan = {
  readonly spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
  readonly recordIdsOrder?: ReadonlyArray<RecordId>;
};

export type TableRecordLinkConditionInput = {
  readonly filterLinkCellSelected?: IncomingLinkSelection;
  readonly filterLinkCellCandidate?: IncomingLinkSelection;
  readonly selectedRecordIds?: ReadonlyArray<string>;
  readonly fieldMasks?: ReadonlyArray<RecordQueryFieldMask>;
};

export const buildLinkCandidatePlan = async (
  deps: TableRecordQueryConditionPlanDeps,
  context: IExecutionContext,
  table: Table,
  filterLinkCellCandidate: IncomingLinkSelection
): Promise<Result<TableRecordLinkCandidatePlan, DomainError>> => {
  return safeTry(async function* () {
    const fieldId = Array.isArray(filterLinkCellCandidate)
      ? filterLinkCellCandidate[0]
      : filterLinkCellCandidate;
    const hostRecordId = Array.isArray(filterLinkCellCandidate)
      ? yield* RecordId.create(filterLinkCellCandidate[1])
      : undefined;
    const linkFieldResult = yield* await resolveIncomingLinkField(deps, context, table, fieldId);
    const linkField = linkFieldResult.linkField;
    const selfKeyName = yield* linkField.selfKeyNameString();
    const fkHostTableName = yield* linkField.fkHostTableNameString();
    const foreignKeyName = yield* linkField.foreignKeyNameString();

    let candidateSpec: IncomingLinkCandidateSpec | undefined;
    if (linkField.relationship().toString() === 'oneMany') {
      candidateSpec = isJunctionTable(fkHostTableName)
        ? IncomingLinkCandidateSpec.create({
            mode: 'junctionReferenceAvailable',
            selfKeyName,
            hostRecordId,
            fkHostTableName,
            foreignKeyName,
          })
        : IncomingLinkCandidateSpec.create({
            mode: 'currentColumnAvailable',
            selfKeyName,
            hostRecordId,
          });
    } else if (linkField.relationship().toString() === 'oneOne') {
      candidateSpec =
        selfKeyName === '__id'
          ? IncomingLinkCandidateSpec.create({
              mode: 'hostReferenceAvailable',
              selfKeyName,
              hostRecordId,
              fkHostTableName,
              foreignKeyName,
            })
          : IncomingLinkCandidateSpec.create({
              mode: 'currentColumnAvailable',
              selfKeyName,
              hostRecordId,
            });
    }

    let linkFilterSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | null = null;
    const rawFilter = linkField.config().filter();
    if (rawFilter !== null && rawFilter !== undefined) {
      const conditionResult = FieldCondition.create({ filter: rawFilter });
      if (conditionResult.isOk()) {
        const specResult = conditionResult.value.toRecordConditionSpec(table);
        if (specResult.isOk()) {
          linkFilterSpec = specResult.value;
        } else {
          deps.logger.warn('Failed to build link field filter spec', {
            fieldId,
            error: specResult.error,
          });
        }
      } else {
        deps.logger.warn('Failed to parse link field filter', {
          fieldId,
          error: conditionResult.error,
        });
      }
    }

    const filterByViewId = linkField.filterByViewId()?.toString() ?? undefined;
    return ok({ candidateSpec, linkFilterSpec, filterByViewId });
  });
};

export const buildTableRecordConditionPlan = async (
  deps: TableRecordQueryConditionPlanDeps,
  context: IExecutionContext,
  table: Table,
  input: TableRecordLinkConditionInput,
  resolvedFilter: RecordFilter | undefined,
  linkCandidatePlan?: TableRecordLinkCandidatePlan
): Promise<Result<TableRecordConditionPlan, DomainError>> => {
  return safeTry(async function* () {
    const builder = RecordConditionSpecBuilder.create();
    let hasSpec = false;
    let recordIdsOrder: ReadonlyArray<RecordId> | undefined;

    if (resolvedFilter) {
      builder.addConditionSpec(
        yield* buildRecordConditionSpec(table, resolvedFilter, input.fieldMasks)
      );
      hasSpec = true;
    }

    if (input.filterLinkCellSelected) {
      const selectedPlan = yield* await buildIncomingLinkSelectedPlan(
        deps,
        context,
        table,
        input.filterLinkCellSelected
      );
      builder.addConditionSpec(selectedPlan.spec);
      recordIdsOrder = selectedPlan.recordIdsOrder;
      hasSpec = true;
    }

    if (input.filterLinkCellCandidate) {
      const plan =
        linkCandidatePlan ??
        (yield* await buildLinkCandidatePlan(deps, context, table, input.filterLinkCellCandidate));

      if (plan.candidateSpec) {
        builder.addConditionSpec(plan.candidateSpec);
        hasSpec = true;
      }
      if (plan.linkFilterSpec) {
        builder.addConditionSpec(plan.linkFilterSpec);
        hasSpec = true;
      }
    }

    if (input.selectedRecordIds?.length) {
      const selectedRecordIds = input.selectedRecordIds.map((recordId) =>
        RecordId.create(recordId)
      );
      const invalidSelectedRecordId = selectedRecordIds.find((result) => result.isErr());
      if (invalidSelectedRecordId?.isErr()) {
        return err(invalidSelectedRecordId.error);
      }

      const selectedIdsSpec = RecordByIdsSpec.create(
        selectedRecordIds.map((result) => result._unsafeUnwrap())
      );
      if (input.filterLinkCellCandidate) {
        builder.not((notBuilder) => {
          notBuilder.addConditionSpec(selectedIdsSpec);
          return notBuilder;
        });
      } else {
        builder.addConditionSpec(selectedIdsSpec);
      }
      hasSpec = true;
    }

    return ok({
      spec: hasSpec ? yield* builder.build() : undefined,
      recordIdsOrder,
    });
  });
};

const buildIncomingLinkSelectedPlan = async (
  deps: TableRecordQueryConditionPlanDeps,
  context: IExecutionContext,
  table: Table,
  filterLinkCellSelected: IncomingLinkSelection
): Promise<
  Result<
    {
      spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
      recordIdsOrder?: ReadonlyArray<RecordId>;
    },
    DomainError
  >
> => {
  return safeTry(async function* () {
    const fieldId = Array.isArray(filterLinkCellSelected)
      ? filterLinkCellSelected[0]
      : filterLinkCellSelected;
    const hostRecordId = Array.isArray(filterLinkCellSelected)
      ? yield* RecordId.create(filterLinkCellSelected[1])
      : undefined;
    const linkFieldResult = yield* await resolveIncomingLinkField(deps, context, table, fieldId);
    const currentTableDbName = yield* table
      .dbTableName()
      .andThen((dbTableName) => dbTableName.value());
    const hostTableDbName = yield* linkFieldResult.hostTable
      .dbTableName()
      .andThen((dbTableName) => dbTableName.value());
    const selfKeyName = yield* linkFieldResult.linkField.selfKeyNameString();
    const fkHostTableName = yield* linkFieldResult.linkField.fkHostTableNameString();
    const foreignKeyName = yield* linkFieldResult.linkField.foreignKeyNameString();

    if (hostRecordId) {
      const hostRecord = yield* await deps.tableRecordQueryRepository.findOne(
        context,
        linkFieldResult.hostTable,
        hostRecordId,
        { mode: 'stored' }
      );
      const recordIds = yield* extractLinkedRecordIds(
        hostRecord.fields[linkFieldResult.linkField.id().toString()]
      );

      return ok({
        spec: RecordByIdsSpec.create(recordIds),
        recordIdsOrder: recordIds,
      });
    }

    return ok({
      spec:
        fkHostTableName === currentTableDbName || hostTableDbName === currentTableDbName
          ? IncomingLinkSelectedSpec.create({
              mode: 'currentColumnNotNull',
              selfKeyName,
            })
          : IncomingLinkSelectedSpec.create({
              mode: 'hostReferenceExists',
              selfKeyName,
              fkHostTableName,
              foreignKeyName,
            }),
    });
  });
};

const resolveIncomingLinkField = async (
  deps: TableRecordQueryConditionPlanDeps,
  context: IExecutionContext,
  table: Table,
  rawFieldId: string
): Promise<Result<{ hostTable: Table; linkField: LinkField }, DomainError>> => {
  return safeTry(async function* () {
    const fieldId = yield* FieldId.create(rawFieldId);
    const hostTables = yield* await deps.tableRepository.find(
      context,
      TableByIncomingReferenceToTableSpec.create(table.id())
    );

    for (const hostTable of hostTables) {
      const linkField = hostTable.getFields().find((field): field is LinkField => {
        return field.type().toString() === 'link' && field.id().equals(fieldId);
      });

      if (linkField && linkField.foreignTableId().equals(table.id())) {
        return ok({ hostTable, linkField });
      }
    }

    return err(
      domainError.notFound({
        code: 'field.not_found',
        message: `Field not found: ${rawFieldId}`,
        details: { fieldId: rawFieldId },
      })
    );
  });
};

const extractLinkedRecordIds = (value: unknown): Result<ReadonlyArray<RecordId>, DomainError> => {
  const rawIds = Array.isArray(value)
    ? value
        .map((item) =>
          item && typeof item === 'object' && 'id' in item ? (item.id as unknown) : undefined
        )
        .filter((item): item is string => typeof item === 'string')
    : value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
      ? [value.id]
      : [];

  const recordIds = rawIds.map((recordId) => RecordId.create(recordId));
  const invalidRecordId = recordIds.find((result) => result.isErr());
  if (invalidRecordId?.isErr()) {
    return err(invalidRecordId.error);
  }

  return ok(recordIds.map((result) => result._unsafeUnwrap()));
};

const isJunctionTable = (dbTableName: string): boolean => {
  if (dbTableName.includes('.')) {
    return dbTableName.split('.')[1]?.startsWith('junction') ?? false;
  }
  return dbTableName.split('_')[1]?.startsWith('junction') ?? false;
};
