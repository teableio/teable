import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import type { ButtonConfirm } from './ButtonConfirm';
import { ButtonLabel } from './ButtonLabel';
import type { ButtonMaxCount } from './ButtonMaxCount';
import type { ButtonResetCount } from './ButtonResetCount';
import type { ButtonWorkflow } from './ButtonWorkflow';
import { FieldColor } from './FieldColor';

export class ButtonField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly labelValue: ButtonLabel,
    private readonly colorValue: FieldColor,
    private readonly maxCountValue: ButtonMaxCount | undefined,
    private readonly resetCountValue: ButtonResetCount | undefined,
    private readonly workflowValue: ButtonWorkflow | undefined,
    private readonly confirmValue: ButtonConfirm | undefined
  ) {
    super(id, name, FieldType.button());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    label?: ButtonLabel;
    color?: FieldColor;
    maxCount?: ButtonMaxCount;
    resetCount?: ButtonResetCount;
    workflow?: ButtonWorkflow;
    confirm?: ButtonConfirm;
  }): Result<ButtonField, DomainError> {
    return ok(
      new ButtonField(
        params.id,
        params.name,
        params.label ?? ButtonLabel.default(),
        params.color ?? FieldColor.from('teal'),
        params.maxCount,
        params.resetCount,
        params.workflow,
        params.confirm
      )
    );
  }

  label(): ButtonLabel {
    return this.labelValue;
  }

  color(): FieldColor {
    return this.colorValue;
  }

  maxCount(): ButtonMaxCount | undefined {
    return this.maxCountValue;
  }

  resetCount(): ButtonResetCount | undefined {
    return this.resetCountValue;
  }

  workflow(): ButtonWorkflow | undefined {
    return this.workflowValue;
  }

  confirm(): ButtonConfirm | undefined {
    return this.confirmValue;
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return ButtonField.create({
      id: params.newId,
      name: params.newName,
      label: this.label(),
      color: this.color(),
      maxCount: this.maxCount(),
      resetCount: this.resetCount(),
      workflow: undefined,
      confirm: this.confirm(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitButtonField(this);
  }
}
