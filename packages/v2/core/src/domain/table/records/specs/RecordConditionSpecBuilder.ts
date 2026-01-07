import type { Result } from 'neverthrow';
import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import { SpecBuilder } from '../../../shared/specification/SpecBuilder';
import type { SpecBuilderMode } from '../../../shared/specification/SpecBuilder';
import type { Field } from '../../fields/Field';
import type { RecordId } from '../RecordId';
import type { TableRecord } from '../TableRecord';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import { RecordByIdSpec } from './RecordByIdSpec';
import type { RecordConditionOperator } from './RecordConditionOperators';
import type { RecordConditionValue } from './RecordConditionValues';

export class RecordConditionSpecBuilder extends SpecBuilder<
  TableRecord,
  ITableRecordConditionSpecVisitor,
  RecordConditionSpecBuilder
> {
  private constructor(mode: SpecBuilderMode = 'and') {
    super(mode);
  }

  static create(mode: SpecBuilderMode = 'and'): RecordConditionSpecBuilder {
    return new RecordConditionSpecBuilder(mode);
  }

  addCondition(params: {
    field: Field;
    operator: RecordConditionOperator;
    value?: RecordConditionValue;
  }): RecordConditionSpecBuilder {
    const specResult = params.field
      .spec()
      .create({ operator: params.operator, value: params.value });
    specResult.match(
      (spec) => this.addSpec(spec),
      (error) => this.recordError(error)
    );
    return this;
  }

  addConditionSpec(
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): RecordConditionSpecBuilder {
    this.addSpec(spec);
    return this;
  }

  recordId(recordId: RecordId): RecordConditionSpecBuilder {
    this.addSpec(RecordByIdSpec.create(recordId));
    return this;
  }

  andGroup(build: (builder: RecordConditionSpecBuilder) => RecordConditionSpecBuilder): this {
    this.addGroup('and', build);
    return this;
  }

  orGroup(build: (builder: RecordConditionSpecBuilder) => RecordConditionSpecBuilder): this {
    this.addGroup('or', build);
    return this;
  }

  not(build: (builder: RecordConditionSpecBuilder) => RecordConditionSpecBuilder): this {
    const nested = build(this.createChild('and'));
    const result = nested.build();
    result.match(
      (spec) => this.addNotSpec(spec),
      (error) => this.recordError(error)
    );
    return this;
  }

  build(): Result<ISpecification<TableRecord, ITableRecordConditionSpecVisitor>, DomainError> {
    return this.buildFrom(this.specs);
  }

  protected createChild(mode: SpecBuilderMode): RecordConditionSpecBuilder {
    return new RecordConditionSpecBuilder(mode);
  }
}
