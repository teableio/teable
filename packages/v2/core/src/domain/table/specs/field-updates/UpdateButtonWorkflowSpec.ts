import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { ButtonField } from '../../fields/types/ButtonField';
import type { ButtonWorkflow } from '../../fields/types/ButtonWorkflow';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a button field's workflow.
 */
export class UpdateButtonWorkflowSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousWorkflowValue: ButtonWorkflow | undefined,
    private readonly nextWorkflowValue: ButtonWorkflow | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousWorkflow: ButtonWorkflow | undefined,
    nextWorkflow: ButtonWorkflow | undefined
  ): UpdateButtonWorkflowSpec {
    return new UpdateButtonWorkflowSpec(fieldId, previousWorkflow, nextWorkflow);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousWorkflow(): ButtonWorkflow | undefined {
    return this.previousWorkflowValue;
  }

  nextWorkflow(): ButtonWorkflow | undefined {
    return this.nextWorkflowValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof ButtonField)) {
      return err(domainError.validation({ message: 'Field is not a button field' }));
    }

    const updatedFieldResult = ButtonField.create({
      id: field.id(),
      name: field.name(),
      label: field.label(),
      color: field.color(),
      maxCount: field.maxCount(),
      resetCount: field.resetCount(),
      workflow: this.nextWorkflowValue,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateButtonWorkflow(this).map(() => undefined);
  }
}
