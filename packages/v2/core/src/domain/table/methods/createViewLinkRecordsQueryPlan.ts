import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { FieldId } from '../fields/FieldId';
import { FieldCondition } from '../fields/types/FieldCondition';
import { LinkField } from '../fields/types/LinkField';
import { IncomingLinkCandidateSpec } from '../records/specs/IncomingLinkCandidateSpec';
import { IncomingLinkSelectedSpec } from '../records/specs/IncomingLinkSelectedSpec';
import type { ITableRecordConditionSpecVisitor } from '../records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../records/TableRecord';
import type { Table } from '../Table';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';

export type ViewLinkRecordsRequestType = 'candidate' | 'selected';
export type ViewLinkRecordsSelectionType = 'candidate' | 'selected';

export type CreateViewLinkRecordsQueryPlanParams = {
  readonly viewId: ViewId;
  readonly fieldId: FieldId;
  readonly requestType?: ViewLinkRecordsRequestType;
  readonly includeHiddenFields?: boolean;
};

const isJunctionTable = (dbTableName: string): boolean => {
  if (dbTableName.includes('.')) {
    return dbTableName.split('.')[1]?.startsWith('junction') ?? false;
  }
  return dbTableName.split('_')[1]?.startsWith('junction') ?? false;
};

export class ViewLinkRecordsQueryPlan {
  private constructor(
    private readonly linkFieldValue: LinkField,
    readonly selectionType: ViewLinkRecordsSelectionType
  ) {}

  static create(
    linkField: LinkField,
    selectionType: ViewLinkRecordsSelectionType
  ): ViewLinkRecordsQueryPlan {
    return new ViewLinkRecordsQueryPlan(linkField, selectionType);
  }

  foreignTableId(): TableId {
    return this.linkFieldValue.foreignTableId();
  }

  lookupFieldId(): FieldId {
    return this.linkFieldValue.lookupFieldId();
  }

  linkFieldId(): FieldId {
    return this.linkFieldValue.id();
  }

  filterByViewId(): ViewId | null | undefined {
    return this.selectionType === 'candidate' ? this.linkFieldValue.filterByViewId() : undefined;
  }

  validateTargetTable(targetTable: Table): Result<void, DomainError> {
    if (!targetTable.id().equals(this.foreignTableId())) {
      return err(
        domainError.invariant({
          code: 'view_link_records.target_table_mismatch',
          message: 'Link Record target Table does not match the Link Field',
        })
      );
    }
    return targetTable
      .getField((field) => field.id().equals(this.lookupFieldId()))
      .map(() => void 0);
  }

  linkFilterSpec(
    targetTable: Table
  ): Result<
    ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    DomainError
  > {
    if (this.selectionType !== 'candidate') return ok(undefined);
    const filter = this.linkFieldValue.config().filter();
    if (filter == null) return ok(undefined);
    return FieldCondition.create({ filter }).andThen((condition) =>
      condition.toRecordConditionSpec(targetTable).map((spec) => spec ?? undefined)
    );
  }

  selectionSpec(
    sourceTable: Table,
    targetTable: Table
  ): Result<
    ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    DomainError
  > {
    return safeTry(
      function* (this: ViewLinkRecordsQueryPlan) {
        yield* this.validateTargetTable(targetTable);
        const currentTableDbName = yield* targetTable
          .dbTableName()
          .andThen((dbTableName) => dbTableName.value());
        const hostTableDbName = yield* sourceTable
          .dbTableName()
          .andThen((dbTableName) => dbTableName.value());
        const selfKeyName = yield* this.linkFieldValue.selfKeyNameString();
        const fkHostTableName = yield* this.linkFieldValue.fkHostTableNameString();
        const foreignKeyName = yield* this.linkFieldValue.foreignKeyNameString();

        if (this.selectionType === 'selected') {
          return ok(
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
                })
          );
        }

        if (this.linkFieldValue.relationship().toString() === 'oneMany') {
          return ok(
            isJunctionTable(fkHostTableName)
              ? IncomingLinkCandidateSpec.create({
                  mode: 'junctionReferenceAvailable',
                  selfKeyName,
                  fkHostTableName,
                  foreignKeyName,
                })
              : IncomingLinkCandidateSpec.create({
                  mode: 'currentColumnAvailable',
                  selfKeyName,
                })
          );
        }
        if (this.linkFieldValue.relationship().toString() === 'oneOne') {
          return ok(
            selfKeyName === '__id'
              ? IncomingLinkCandidateSpec.create({
                  mode: 'hostReferenceAvailable',
                  selfKeyName,
                  fkHostTableName,
                  foreignKeyName,
                })
              : IncomingLinkCandidateSpec.create({
                  mode: 'currentColumnAvailable',
                  selfKeyName,
                })
          );
        }
        return ok(undefined);
      }.bind(this)
    );
  }
}

/**
 * Resolve the complete cross-table Record-query intent for a Link Field owned by this Table.
 *
 * The application layer may execute this plan against the existing Table Record query path,
 * but it must not reinterpret View subtype, Field visibility, or Link configuration.
 */
export function createViewLinkRecordsQueryPlan(
  this: Table,
  params: CreateViewLinkRecordsQueryPlanParams
): Result<ViewLinkRecordsQueryPlan, DomainError> {
  return safeTry<ViewLinkRecordsQueryPlan, DomainError>(
    function* (this: Table) {
      const view = yield* this.getView(params.viewId);
      if (!params.includeHiddenFields) {
        const visibleFieldIds = yield* this.getOrderedVisibleFieldIds(params.viewId.toString());
        if (!visibleFieldIds.some((fieldId) => fieldId.equals(params.fieldId))) {
          return err(
            domainError.forbidden({
              code: 'view_link_records.field_hidden',
              message: 'field is hidden, not allowed',
              details: { fieldId: params.fieldId.toString() },
            })
          );
        }
      }

      const field = yield* this.getField((candidate) => candidate.id().equals(params.fieldId));
      if (!(field instanceof LinkField)) {
        return err(
          domainError.forbidden({
            code: 'view_link_records.field_not_link',
            message: 'Field type is not link field',
            details: { fieldId: params.fieldId.toString() },
          })
        );
      }

      const viewType = view.type().toString();
      const selectionType: ViewLinkRecordsSelectionType =
        viewType === 'form' || (viewType === 'plugin' && params.requestType === 'candidate')
          ? 'candidate'
          : 'selected';

      return ok(ViewLinkRecordsQueryPlan.create(field, selectionType));
    }.bind(this)
  );
}
