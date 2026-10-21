import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { RecordFilter } from '../../../queries/RecordFilterDto';
import { domainError, type DomainError } from '../../shared/DomainError';
import type { FieldId } from '../fields/FieldId';
import { ButtonField } from '../fields/types/ButtonField';
import type { RecordId } from '../records/RecordId';
import { RecordUpdateResult } from '../records/RecordUpdateResult';
import {
  type ButtonCellValue,
  SetButtonValueSpec,
} from '../records/specs/values/SetButtonValueSpec';
import { TableRecord } from '../records/TableRecord';
import { CellValue } from '../records/values/CellValue';
import type { Table } from '../Table';
import type { ViewId } from '../views/ViewId';

export type CreateButtonClickPlanParams = {
  readonly fieldId: FieldId;
  readonly shareScope?: {
    readonly viewId: ViewId;
    readonly includeHiddenFields: boolean;
    readonly includeRecords: boolean;
  };
};

export class ButtonClickPlan {
  private constructor(
    private readonly buttonField: ButtonField,
    private readonly workflowIdValue: string,
    private readonly viewFilterValue: RecordFilter | null | undefined
  ) {}

  static create(
    buttonField: ButtonField,
    workflowId: string,
    viewFilter: RecordFilter | null | undefined
  ): ButtonClickPlan {
    return new ButtonClickPlan(buttonField, workflowId, viewFilter);
  }

  fieldId(): FieldId {
    return this.buttonField.id();
  }

  workflowId(): string {
    return this.workflowIdValue;
  }

  viewFilter(): RecordFilter | null | undefined {
    return this.viewFilterValue;
  }

  click(
    table: Table,
    recordId: RecordId,
    currentValue: unknown
  ): Result<RecordUpdateResult, DomainError> {
    const currentCount = ButtonClickPlan.readCount(currentValue);
    const maxCount = this.buttonField.maxCount()?.toNumber() ?? 0;
    const fieldId = this.fieldId();
    if (maxCount > 0 && currentCount >= maxCount) {
      return err(
        domainError.validation({
          code: 'button.click_count_reached_max',
          message: `Button click count ${currentCount} reached max count ${maxCount}`,
          details: {
            fieldId: this.fieldId().toString(),
            count: currentCount,
            maxCount,
            i18nKey: 'httpErrors.field.button.clickCountReachedMaxCount',
          },
        })
      );
    }

    return safeTry<RecordUpdateResult, DomainError>(function* () {
      const record = yield* TableRecord.create({
        id: recordId,
        tableId: table.id(),
        fieldValues: [],
      });
      const value = CellValue.fromValidated<ButtonCellValue>({ count: currentCount + 1 });
      const mutateSpec = new SetButtonValueSpec(fieldId, value);
      const updatedRecord = yield* mutateSpec.mutate(record);
      return ok(
        RecordUpdateResult.create(
          updatedRecord,
          mutateSpec,
          new Map([[fieldId.toString(), fieldId.toString()]])
        )
      );
    });
  }

  private static readCount(value: unknown): number {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return 0;
    const count = (value as { count?: unknown }).count;
    return typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }
}

export function createButtonClickPlan(
  this: Table,
  params: CreateButtonClickPlanParams
): Result<ButtonClickPlan, DomainError> {
  return safeTry<ButtonClickPlan, DomainError>(
    function* (this: Table) {
      let viewFilter: RecordFilter | null | undefined;
      if (params.shareScope) {
        if (!params.shareScope.includeRecords) {
          return err(
            domainError.forbidden({
              code: 'button.shared_records_disabled',
              message: 'Shared View does not include records',
              details: { fieldId: params.fieldId.toString() },
            })
          );
        }
        const view = yield* this.getView(params.shareScope.viewId);
        if (!params.shareScope.includeHiddenFields) {
          const visibleFieldIds = yield* this.getOrderedVisibleFieldIds(
            params.shareScope.viewId.toString()
          );
          if (!visibleFieldIds.some((fieldId) => fieldId.equals(params.fieldId))) {
            return err(
              domainError.forbidden({
                code: 'button.shared_field_hidden',
                message: 'Field is hidden in the shared View',
                details: { fieldId: params.fieldId.toString() },
              })
            );
          }
        }
        viewFilter = (yield* view.queryDefaults()).filter();
      }

      const field = yield* this.getField((candidate) => candidate.id().equals(params.fieldId));
      if (!(field instanceof ButtonField)) {
        return err(
          domainError.validation({
            code: 'button.field_type_invalid',
            message: 'Field is not a Button field',
            details: { fieldId: params.fieldId.toString() },
          })
        );
      }
      const workflow = field.workflow()?.toDto();
      if (!workflow?.id || workflow.isActive !== true) {
        return err(
          domainError.validation({
            code: 'button.workflow_not_active',
            message: `Button field's workflow ${workflow?.id ?? ''} is not active`,
            details: {
              fieldId: params.fieldId.toString(),
              workflowId: workflow?.id,
              i18nKey: 'httpErrors.workflow.notActive',
            },
          })
        );
      }

      return ok(ButtonClickPlan.create(field, workflow.id, viewFilter));
    }.bind(this)
  );
}
