import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import type { Table } from '../Table';
import { ViewType } from '../views/ViewType';

const isMissingRequiredValue = (value: unknown): boolean => value === null || value === undefined;

export function validateFormSubmission(
  this: Table,
  formId: string,
  fieldValues: ReadonlyMap<string, unknown>
): Result<void, DomainError> {
  const formViewResult = this.getViewById(formId);
  if (formViewResult.isErr()) return err(formViewResult.error);

  const formView = formViewResult.value;
  if (!formView.type().equals(ViewType.form())) {
    return err(
      domainError.forbidden({
        code: 'view.type_not_form',
        message: 'View is not a form',
      })
    );
  }

  const visibleFieldIdsResult = this.getOrderedVisibleFieldIds(formId);
  if (visibleFieldIdsResult.isErr()) return err(visibleFieldIdsResult.error);

  const visibleFieldIds = visibleFieldIdsResult.value;
  const visibleFieldIdSet = new Set(visibleFieldIds.map((fieldId) => fieldId.toString()));

  for (const fieldId of fieldValues.keys()) {
    if (!visibleFieldIdSet.has(fieldId)) {
      return err(
        domainError.forbidden({
          code: 'view.hidden_fields_submission_not_allowed',
          message: 'The form contains hidden fields, submission not allowed.',
        })
      );
    }
  }

  const columnMetaResult = formView.columnMeta();
  if (columnMetaResult.isErr()) return err(columnMetaResult.error);
  const columnMeta = columnMetaResult.value.toDto();

  const missingRequiredFieldIds: string[] = [];
  for (const visibleFieldId of visibleFieldIds) {
    const fieldId = visibleFieldId.toString();
    const requiredByForm = columnMeta[fieldId]?.required === true;
    if (!requiredByForm) continue;

    const value = fieldValues.get(fieldId);
    if (isMissingRequiredValue(value)) {
      missingRequiredFieldIds.push(fieldId);
    }
  }

  if (missingRequiredFieldIds.length > 0) {
    return err(
      domainError.validation({
        code: 'view.required_fields_missing',
        message: 'Required form fields are missing.',
        details: { missingFieldIds: missingRequiredFieldIds },
      })
    );
  }

  return ok(undefined);
}
