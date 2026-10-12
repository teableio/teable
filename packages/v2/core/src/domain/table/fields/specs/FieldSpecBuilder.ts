import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import { SpecBuilder } from '../../../shared/specification/SpecBuilder';
import type { SpecBuilderMode } from '../../../shared/specification/SpecBuilder';
import type { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldByIdSpec } from './FieldByIdSpec';
import { FieldByKeySpec } from './FieldByKeySpec';
import { FieldByNameSpec } from './FieldByNameSpec';
import { FieldIsAttachmentSpec } from './FieldIsAttachmentSpec';
import { FieldIsBooleanValueSpec } from './FieldIsBooleanValueSpec';
import { FieldIsButtonSpec } from './FieldIsButtonSpec';
import { FieldIsCheckboxSpec } from './FieldIsCheckboxSpec';
import { FieldIsComputedSpec } from './FieldIsComputedSpec';
import { FieldIsDateLikeSpec } from './FieldIsDateLikeSpec';
import { FieldIsDateSpec } from './FieldIsDateSpec';
import { FieldIsDateTimeValueSpec } from './FieldIsDateTimeValueSpec';
import { FieldIsFormulaSpec } from './FieldIsFormulaSpec';
import { FieldIsJsonSpec } from './FieldIsJsonSpec';
import { FieldIsLinkSpec } from './FieldIsLinkSpec';
import { FieldIsLongTextSpec } from './FieldIsLongTextSpec';
import { FieldIsLookupSpec } from './FieldIsLookupSpec';
import { FieldIsMultipleSelectSpec } from './FieldIsMultipleSelectSpec';
import { FieldIsNumberFieldSpec } from './FieldIsNumberFieldSpec';
import { FieldIsNumberLikeSpec } from './FieldIsNumberLikeSpec';
import { FieldIsNumberSpec } from './FieldIsNumberSpec';
import { FieldIsNumberValueSpec } from './FieldIsNumberValueSpec';
import { FieldIsPrimarySpec } from './FieldIsPrimarySpec';
import { FieldIsRatingSpec } from './FieldIsRatingSpec';
import { FieldIsRollupSpec } from './FieldIsRollupSpec';
import { FieldIsSingleSelectSpec } from './FieldIsSingleSelectSpec';
import { FieldIsSingleTextSpec } from './FieldIsSingleTextSpec';
import { FieldIsStringValueSpec } from './FieldIsStringValueSpec';
import { FieldIsUserSpec } from './FieldIsUserSpec';

export class FieldSpecBuilder extends SpecBuilder<Field, ISpecVisitor, FieldSpecBuilder> {
  private constructor(mode: SpecBuilderMode = 'and') {
    super(mode);
  }

  static create(mode: SpecBuilderMode = 'and'): FieldSpecBuilder {
    return new FieldSpecBuilder(mode);
  }

  withFieldId(fieldId: FieldId): this {
    this.addSpec(FieldByIdSpec.create(fieldId));
    return this;
  }

  withFieldName(fieldName: FieldName): this {
    this.addSpec(FieldByNameSpec.create(fieldName));
    return this;
  }

  withField(key: string): this {
    this.addSpec(FieldByKeySpec.create(key));
    return this;
  }

  isPrimary(primaryFieldId: FieldId): this {
    this.addSpec(FieldIsPrimarySpec.create(primaryFieldId));
    return this;
  }

  isLink(): this {
    this.addSpec(FieldIsLinkSpec.create());
    return this;
  }

  isFormula(): this {
    this.addSpec(FieldIsFormulaSpec.create());
    return this;
  }

  isRollup(): this {
    this.addSpec(FieldIsRollupSpec.create());
    return this;
  }

  isLookup(): this {
    this.addSpec(FieldIsLookupSpec.create());
    return this;
  }

  isComputed(): this {
    this.addSpec(FieldIsComputedSpec.create());
    return this;
  }

  isSingleText(): this {
    this.addSpec(FieldIsSingleTextSpec.create());
    return this;
  }

  isLongText(): this {
    this.addSpec(FieldIsLongTextSpec.create());
    return this;
  }

  isNumber(): this {
    this.addSpec(FieldIsNumberSpec.create());
    return this;
  }

  isRating(): this {
    this.addSpec(FieldIsRatingSpec.create());
    return this;
  }

  isNumberField(): this {
    this.addSpec(FieldIsNumberFieldSpec.create());
    return this;
  }

  isNumberLike(): this {
    this.addSpec(FieldIsNumberLikeSpec.create());
    return this;
  }

  isNumberValue(): this {
    this.addSpec(FieldIsNumberValueSpec.create());
    return this;
  }

  isSingleSelect(): this {
    this.addSpec(FieldIsSingleSelectSpec.create());
    return this;
  }

  isMultipleSelect(): this {
    this.addSpec(FieldIsMultipleSelectSpec.create());
    return this;
  }

  isCheckbox(): this {
    this.addSpec(FieldIsCheckboxSpec.create());
    return this;
  }

  isAttachment(): this {
    this.addSpec(FieldIsAttachmentSpec.create());
    return this;
  }

  isDate(): this {
    this.addSpec(FieldIsDateSpec.create());
    return this;
  }

  isDateLike(): this {
    this.addSpec(FieldIsDateLikeSpec.create());
    return this;
  }

  isDateTimeValue(): this {
    this.addSpec(FieldIsDateTimeValueSpec.create());
    return this;
  }

  isStringValue(): this {
    this.addSpec(FieldIsStringValueSpec.create());
    return this;
  }

  isBooleanValue(): this {
    this.addSpec(FieldIsBooleanValueSpec.create());
    return this;
  }

  isJson(): this {
    this.addSpec(FieldIsJsonSpec.create());
    return this;
  }

  isUser(): this {
    this.addSpec(FieldIsUserSpec.create());
    return this;
  }

  isButton(): this {
    this.addSpec(FieldIsButtonSpec.create());
    return this;
  }

  andGroup(build: (builder: FieldSpecBuilder) => FieldSpecBuilder): this {
    this.addGroup('and', build);
    return this;
  }

  orGroup(build: (builder: FieldSpecBuilder) => FieldSpecBuilder): this {
    this.addGroup('or', build);
    return this;
  }

  not(build: (builder: FieldSpecBuilder) => FieldSpecBuilder): this {
    const nested = build(this.createChild('and'));
    const result = nested.build();
    result.match(
      (spec) => this.addNotSpec(spec),
      (error) => this.recordError(error)
    );
    return this;
  }

  build(): Result<ISpecification<Field, ISpecVisitor>, DomainError> {
    return this.buildFrom(this.specs);
  }

  protected createChild(mode: SpecBuilderMode): FieldSpecBuilder {
    return new FieldSpecBuilder(mode);
  }
}
