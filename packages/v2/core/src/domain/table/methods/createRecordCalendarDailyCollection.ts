import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import type { Field } from '../fields/Field';
import { FieldDateTimeZoneVisitor } from '../fields/visitors/FieldDateTimeZoneVisitor';
import { FieldValueTypeVisitor } from '../fields/visitors/FieldValueTypeVisitor';
import { TableRecordCalendarDailyCollection } from '../records/TableRecordCalendarDailyCollection';
import type { Table } from '../Table';

export type CreateRecordCalendarDailyCollectionParams = {
  readonly viewId: string;
  readonly startFieldId: string;
  readonly endFieldId?: string;
  readonly includeHiddenFields?: boolean;
};

type CalendarFieldRole = 'start' | 'end';

const resolveCalendarField = (
  table: Table,
  fieldId: string,
  role: CalendarFieldRole,
  visibleFieldIds: ReadonlySet<string> | undefined
): Result<Field, DomainError> => {
  return safeTry(function* () {
    const field = yield* table
      .getField((candidate) => candidate.id().toString() === fieldId)
      .mapErr(() =>
        domainError.validation({
          code: `calendar.invalid_${role}_field`,
          message: `Invalid ${role} date field id`,
          details: { fieldId },
        })
      );
    if (visibleFieldIds && !visibleFieldIds.has(fieldId)) {
      return err(
        domainError.forbidden({
          code: 'calendar.field_hidden',
          message: 'field is hidden, not allowed',
          details: { fieldId, role },
        })
      );
    }
    const valueType = yield* field.accept(new FieldValueTypeVisitor());
    if (
      valueType.cellValueType.toString() !== 'dateTime' ||
      valueType.isMultipleCellValue.toBoolean()
    ) {
      return err(
        domainError.validation({
          code: `calendar.invalid_${role}_field`,
          message: `Invalid ${role} date field id`,
          details: {
            fieldId,
            cellValueType: valueType.cellValueType.toString(),
            isMultipleCellValue: valueType.isMultipleCellValue.toBoolean(),
          },
        })
      );
    }
    return ok(field);
  });
};

export function createRecordCalendarDailyCollection(
  this: Table,
  params: CreateRecordCalendarDailyCollectionParams
): Result<TableRecordCalendarDailyCollection, DomainError> {
  return safeTry<TableRecordCalendarDailyCollection, DomainError>(
    function* (this: Table) {
      yield* this.getViewById(params.viewId);
      const visibleFieldIds = params.includeHiddenFields
        ? undefined
        : new Set((yield* this.getOrderedVisibleFieldIds(params.viewId)).map(String));
      const startField = yield* resolveCalendarField(
        this,
        params.startFieldId,
        'start',
        visibleFieldIds
      );
      const endField = params.endFieldId
        ? yield* resolveCalendarField(this, params.endFieldId, 'end', visibleFieldIds)
        : startField;
      const timeZone = yield* startField.accept(new FieldDateTimeZoneVisitor());

      return ok(
        TableRecordCalendarDailyCollection.create({
          startFieldId: startField.id(),
          endFieldId: endField.id(),
          timeZone,
        })
      );
    }.bind(this)
  );
}
