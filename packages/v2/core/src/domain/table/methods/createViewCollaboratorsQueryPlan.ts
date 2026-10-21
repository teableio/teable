import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { RecordFilter } from '../../../queries/RecordFilterDto';
import { domainError, type DomainError } from '../../shared/DomainError';
import type { Field } from '../fields/Field';
import type { FieldId } from '../fields/FieldId';
import { CreatedByField } from '../fields/types/CreatedByField';
import { LastModifiedByField } from '../fields/types/LastModifiedByField';
import { UserField } from '../fields/types/UserField';
import type { Table } from '../Table';
import type { ViewId } from '../views/ViewId';

export type ViewCollaboratorField = UserField | CreatedByField | LastModifiedByField;
export type ViewCollaboratorsQueryMode = 'all' | 'referenced' | 'empty';

export type CreateViewCollaboratorsQueryPlanParams = {
  readonly viewId?: ViewId;
  readonly fieldId?: FieldId;
  readonly includeHiddenFields?: boolean;
  readonly canReadAllCollaborators?: boolean;
};

const isCollaboratorField = (field: Field): field is ViewCollaboratorField =>
  field instanceof UserField ||
  field instanceof CreatedByField ||
  field instanceof LastModifiedByField;

export const viewCollaboratorFieldIsMultiple = (field: ViewCollaboratorField): boolean =>
  field instanceof UserField && field.multiplicity().toBoolean();

export class ViewCollaboratorsQueryPlan {
  private constructor(
    readonly mode: ViewCollaboratorsQueryMode,
    private readonly fieldValue?: ViewCollaboratorField,
    private readonly recordFilterValue?: RecordFilter | null
  ) {}

  static all(): ViewCollaboratorsQueryPlan {
    return new ViewCollaboratorsQueryPlan('all');
  }

  static referenced(
    field: ViewCollaboratorField,
    recordFilter?: RecordFilter | null
  ): ViewCollaboratorsQueryPlan {
    return new ViewCollaboratorsQueryPlan('referenced', field, recordFilter);
  }

  static empty(): ViewCollaboratorsQueryPlan {
    return new ViewCollaboratorsQueryPlan('empty');
  }

  referencedField(): Result<ViewCollaboratorField, DomainError> {
    if (this.mode === 'referenced' && this.fieldValue) return ok(this.fieldValue);
    return err(
      domainError.invariant({
        code: 'view_collaborators.referenced_field_unavailable',
        message: 'Referenced collaborator field is unavailable for this query mode',
      })
    );
  }

  recordFilter(): RecordFilter | null | undefined {
    return this.recordFilterValue;
  }
}

/**
 * Resolve collaborator visibility and query scope for a View owned by this Table.
 *
 * The application layer executes this immutable plan against the existing Table Record
 * repository and the independent collaborator directory. It must not reinterpret View
 * subtype, Field visibility, or user-related Field semantics.
 */
export function createViewCollaboratorsQueryPlan(
  this: Table,
  params: CreateViewCollaboratorsQueryPlanParams
): Result<ViewCollaboratorsQueryPlan, DomainError> {
  return safeTry<ViewCollaboratorsQueryPlan, DomainError>(
    function* (this: Table) {
      const view = params.viewId ? yield* this.getView(params.viewId) : undefined;
      const viewType = view?.type().toString();
      const canReadAll =
        !view ||
        params.canReadAllCollaborators ||
        viewType === 'form' ||
        viewType === 'kanban' ||
        viewType === 'plugin';

      if (canReadAll) {
        const visibleFieldIds =
          view && !params.includeHiddenFields
            ? new Set(
                (yield* this.getOrderedVisibleFieldIds(view.id().toString())).map((fieldId) =>
                  fieldId.toString()
                )
              )
            : undefined;
        const hasCollaboratorField = this.getFields().some(
          (field) =>
            (!params.fieldId || field.id().equals(params.fieldId)) &&
            (!visibleFieldIds || visibleFieldIds.has(field.id().toString())) &&
            isCollaboratorField(field)
        );
        return ok(
          hasCollaboratorField
            ? ViewCollaboratorsQueryPlan.all()
            : ViewCollaboratorsQueryPlan.empty()
        );
      }

      if (!params.fieldId) {
        return err(
          domainError.validation({
            code: 'view_collaborators.field_required',
            message: 'fieldId is required',
          })
        );
      }

      if (!params.includeHiddenFields) {
        const visibleFieldIds = yield* this.getOrderedVisibleFieldIds(view.id().toString());
        if (!visibleFieldIds.some((fieldId) => fieldId.equals(params.fieldId!))) {
          return err(
            domainError.forbidden({
              code: 'view_collaborators.field_hidden',
              message: 'field is hidden, not allowed',
              details: { fieldId: params.fieldId.toString() },
            })
          );
        }
      }

      const field = yield* this.getField((candidate) => candidate.id().equals(params.fieldId!));
      if (!isCollaboratorField(field)) {
        return err(
          domainError.forbidden({
            code: 'view_collaborators.field_not_user_related',
            message: 'field type is not user-related field',
            details: { fieldId: params.fieldId.toString() },
          })
        );
      }

      const defaults = yield* view.queryDefaults();
      return ok(ViewCollaboratorsQueryPlan.referenced(field, defaults.filter()));
    }.bind(this)
  );
}

export function createRecordCollaboratorsQueryPlan(
  this: Table,
  fieldId: FieldId
): Result<ViewCollaboratorsQueryPlan, DomainError> {
  return safeTry<ViewCollaboratorsQueryPlan, DomainError>(
    function* (this: Table) {
      const field = yield* this.getField((candidate) => candidate.id().equals(fieldId));
      if (!isCollaboratorField(field)) {
        return err(
          domainError.forbidden({
            code: 'record_collaborators.field_not_user_related',
            message: 'field type is not user-related field',
            details: { fieldId: fieldId.toString() },
          })
        );
      }
      return ok(ViewCollaboratorsQueryPlan.referenced(field));
    }.bind(this)
  );
}
