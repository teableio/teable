import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import { TableId } from '../../TableId';
import { Field } from '../Field';
import {
  createAttachmentField,
  createAutoNumberField,
  createButtonField,
  createCheckboxField,
  createCreatedByField,
  createCreatedTimeField,
  createDateField,
  createFormulaField,
  createLastModifiedByField,
  createLastModifiedTimeField,
  createLinkField,
  createLongTextField,
  createMultipleSelectField,
  createNumberField,
  createRatingField,
  createRollupFieldPending,
  createSingleLineTextField,
  createSingleSelectField,
  createUserField,
} from '../FieldFactory';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { FormulaExpression } from '../types/FormulaExpression';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { RollupExpression } from '../types/RollupExpression';
import { RollupFieldConfig } from '../types/RollupFieldConfig';
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

class SpyVisitor implements ISpecVisitor {
  readonly visited: Array<ISpecification> = [];

  visit(spec: ISpecification): Result<void, DomainError> {
    this.visited.push(spec);
    return ok(undefined);
  }
}

const repeatToLength = (seed: string, length: number): string => {
  if (seed.length === 0) return '0'.repeat(length);
  return seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
};

const createFieldId = (seed: string): FieldId =>
  FieldId.create(`fld${repeatToLength(seed, 16)}`)._unsafeUnwrap();

const createTableId = (seed: string): TableId =>
  TableId.create(`tbl${repeatToLength(seed, 16)}`)._unsafeUnwrap();

const createFieldName = (value: string): FieldName => FieldName.create(value)._unsafeUnwrap();

const buildFields = () => {
  const singleText = createSingleLineTextField({
    id: createFieldId('a'),
    name: createFieldName('Single Line'),
  })._unsafeUnwrap();
  const longText = createLongTextField({
    id: createFieldId('b'),
    name: createFieldName('Long Text'),
  })._unsafeUnwrap();
  const number = createNumberField({
    id: createFieldId('c'),
    name: createFieldName('Number'),
  })._unsafeUnwrap();
  const rating = createRatingField({
    id: createFieldId('d'),
    name: createFieldName('Rating'),
  })._unsafeUnwrap();
  const formulaExpression = FormulaExpression.create('')._unsafeUnwrap();
  const formula = createFormulaField({
    id: createFieldId('e'),
    name: createFieldName('Formula'),
    expression: formulaExpression,
  })._unsafeUnwrap();
  const rollupConfig = RollupFieldConfig.create({
    linkFieldId: createFieldId('f').toString(),
    foreignTableId: createTableId('f').toString(),
    lookupFieldId: createFieldId('g').toString(),
  })._unsafeUnwrap();
  const rollup = createRollupFieldPending({
    id: createFieldId('h'),
    name: createFieldName('Rollup'),
    config: rollupConfig,
    expression: RollupExpression.default(),
  })._unsafeUnwrap();
  const singleSelect = createSingleSelectField({
    id: createFieldId('i'),
    name: createFieldName('Single Select'),
    options: [],
  })._unsafeUnwrap();
  const multipleSelect = createMultipleSelectField({
    id: createFieldId('j'),
    name: createFieldName('Multiple Select'),
    options: [],
  })._unsafeUnwrap();
  const checkbox = createCheckboxField({
    id: createFieldId('k'),
    name: createFieldName('Checkbox'),
  })._unsafeUnwrap();
  const attachment = createAttachmentField({
    id: createFieldId('l'),
    name: createFieldName('Attachment'),
  })._unsafeUnwrap();
  const date = createDateField({
    id: createFieldId('m'),
    name: createFieldName('Date'),
  })._unsafeUnwrap();
  const createdTime = createCreatedTimeField({
    id: createFieldId('m1'),
    name: createFieldName('Created Time'),
  })._unsafeUnwrap();
  const lastModifiedTime = createLastModifiedTimeField({
    id: createFieldId('m2'),
    name: createFieldName('Last Modified Time'),
    trackedFieldIds: [],
  })._unsafeUnwrap();
  const user = createUserField({
    id: createFieldId('n'),
    name: createFieldName('User'),
  })._unsafeUnwrap();
  const createdBy = createCreatedByField({
    id: createFieldId('n1'),
    name: createFieldName('Created By'),
  })._unsafeUnwrap();
  const lastModifiedBy = createLastModifiedByField({
    id: createFieldId('n2'),
    name: createFieldName('Last Modified By'),
    trackedFieldIds: [],
  })._unsafeUnwrap();
  const autoNumber = createAutoNumberField({
    id: createFieldId('n3'),
    name: createFieldName('Auto Number'),
  })._unsafeUnwrap();
  const button = createButtonField({
    id: createFieldId('o'),
    name: createFieldName('Button'),
  })._unsafeUnwrap();
  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyMany',
    foreignTableId: createTableId('p').toString(),
    lookupFieldId: createFieldId('q').toString(),
  })._unsafeUnwrap();
  const link = createLinkField({
    id: createFieldId('r'),
    name: createFieldName('Link'),
    config: linkConfig,
  })._unsafeUnwrap();

  return {
    singleText,
    longText,
    number,
    rating,
    formula,
    rollup,
    singleSelect,
    multipleSelect,
    checkbox,
    attachment,
    date,
    createdTime,
    lastModifiedTime,
    user,
    createdBy,
    lastModifiedBy,
    autoNumber,
    button,
    link,
  };
};

const assertSpec = (params: { spec: ISpecification; match: Field; other: Field }) => {
  expect(params.spec.isSatisfiedBy(params.match)).toBe(true);
  expect(params.spec.isSatisfiedBy(params.other)).toBe(false);
  params.spec.mutate(params.match)._unsafeUnwrap();
  const visitor = new SpyVisitor();
  params.spec.accept(visitor)._unsafeUnwrap();
  expect(visitor.visited[0]).toBe(params.spec);
};

const assertBuilder = (
  build: (builder: ReturnType<typeof Field.specs>) => ReturnType<typeof Field.specs>,
  match: Field,
  other: Field
) => {
  const result = build(Field.specs()).build();
  result._unsafeUnwrap();
  const spec = result._unsafeUnwrap();
  expect(spec.isSatisfiedBy(match)).toBe(true);
  expect(spec.isSatisfiedBy(other)).toBe(false);
};

describe('Field specs', () => {
  it('matches field identity specs', () => {
    const fields = buildFields();
    const byId = FieldByIdSpec.create(fields.number.id());
    const byName = FieldByNameSpec.create(fields.number.name());
    assertSpec({ spec: byId, match: fields.number, other: fields.singleText });
    assertSpec({ spec: byName, match: fields.number, other: fields.singleText });

    assertBuilder((builder) => builder.withFieldId(fields.number.id()), fields.number, fields.link);
    assertBuilder(
      (builder) => builder.withFieldName(fields.number.name()),
      fields.number,
      fields.link
    );
  });

  it('matches field by key spec using fieldId', () => {
    const fields = buildFields();
    const byKey = FieldByKeySpec.create(fields.number.id().toString());

    expect(byKey.isSatisfiedBy(fields.number)).toBe(true);
    expect(byKey.isSatisfiedBy(fields.singleText)).toBe(false);
    expect(byKey.key()).toBe(fields.number.id().toString());

    // Test mutate returns the same field
    const mutated = byKey.mutate(fields.number)._unsafeUnwrap();
    expect(mutated).toBe(fields.number);

    // Test visitor
    const visitor = new SpyVisitor();
    byKey.accept(visitor)._unsafeUnwrap();
    expect(visitor.visited[0]).toBe(byKey);

    // Test builder
    assertBuilder(
      (builder) => builder.withField(fields.number.id().toString()),
      fields.number,
      fields.link
    );
  });

  it('matches field by key spec using fieldName', () => {
    const fields = buildFields();
    const byKey = FieldByKeySpec.create(fields.number.name().toString());

    expect(byKey.isSatisfiedBy(fields.number)).toBe(true);
    expect(byKey.isSatisfiedBy(fields.singleText)).toBe(false);
    expect(byKey.key()).toBe(fields.number.name().toString());

    // Test builder
    assertBuilder(
      (builder) => builder.withField(fields.number.name().toString()),
      fields.number,
      fields.link
    );
  });

  it('does not match when key is neither fieldId nor fieldName', () => {
    const fields = buildFields();
    const byKey = FieldByKeySpec.create('unknown_key');

    expect(byKey.isSatisfiedBy(fields.number)).toBe(false);
    expect(byKey.isSatisfiedBy(fields.singleText)).toBe(false);
  });

  it('matches field type specs', () => {
    const fields = buildFields();
    const cases = [
      {
        spec: FieldIsSingleTextSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isSingleText(),
        match: fields.singleText,
        other: fields.longText,
      },
      {
        spec: FieldIsLongTextSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isLongText(),
        match: fields.longText,
        other: fields.singleText,
      },
      {
        spec: FieldIsNumberSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isNumber(),
        match: fields.number,
        other: fields.rating,
      },
      {
        spec: FieldIsRatingSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isRating(),
        match: fields.rating,
        other: fields.number,
      },
      {
        spec: FieldIsFormulaSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isFormula(),
        match: fields.formula,
        other: fields.number,
      },
      {
        spec: FieldIsRollupSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isRollup(),
        match: fields.rollup,
        other: fields.number,
      },
      {
        spec: FieldIsSingleSelectSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isSingleSelect(),
        match: fields.singleSelect,
        other: fields.multipleSelect,
      },
      {
        spec: FieldIsMultipleSelectSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isMultipleSelect(),
        match: fields.multipleSelect,
        other: fields.singleSelect,
      },
      {
        spec: FieldIsCheckboxSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isCheckbox(),
        match: fields.checkbox,
        other: fields.number,
      },
      {
        spec: FieldIsAttachmentSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isAttachment(),
        match: fields.attachment,
        other: fields.number,
      },
      {
        spec: FieldIsDateSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isDate(),
        match: fields.date,
        other: fields.number,
      },
      {
        spec: FieldIsUserSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isUser(),
        match: fields.user,
        other: fields.number,
      },
      {
        spec: FieldIsButtonSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isButton(),
        match: fields.button,
        other: fields.number,
      },
      {
        spec: FieldIsLinkSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isLink(),
        match: fields.link,
        other: fields.number,
      },
    ];

    for (const entry of cases) {
      assertSpec({ spec: entry.spec, match: entry.match, other: entry.other });
      assertBuilder(entry.builder, entry.match, entry.other);
    }
  });

  it('matches field attribute specs', () => {
    const fields = buildFields();
    const computed = FieldIsComputedSpec.create();
    assertSpec({ spec: computed, match: fields.formula, other: fields.number });
    assertBuilder((builder) => builder.isComputed(), fields.formula, fields.number);

    const numberField = FieldIsNumberFieldSpec.create();
    expect(numberField.isSatisfiedBy(fields.number)).toBe(true);
    expect(numberField.isSatisfiedBy(fields.rating)).toBe(true);
    expect(numberField.isSatisfiedBy(fields.autoNumber)).toBe(true);
    expect(numberField.isSatisfiedBy(fields.singleText)).toBe(false);
    assertBuilder((builder) => builder.isNumberField(), fields.number, fields.singleText);

    const numberLike = FieldIsNumberLikeSpec.create();
    expect(numberLike.isSatisfiedBy(fields.number)).toBe(true);
    expect(numberLike.isSatisfiedBy(fields.rating)).toBe(true);
    expect(numberLike.isSatisfiedBy(fields.autoNumber)).toBe(true);
    expect(numberLike.isSatisfiedBy(fields.date)).toBe(false);
    assertBuilder((builder) => builder.isNumberLike(), fields.number, fields.date);

    const dateLike = FieldIsDateLikeSpec.create();
    expect(dateLike.isSatisfiedBy(fields.date)).toBe(true);
    expect(dateLike.isSatisfiedBy(fields.createdTime)).toBe(true);
    expect(dateLike.isSatisfiedBy(fields.lastModifiedTime)).toBe(true);
    expect(dateLike.isSatisfiedBy(fields.number)).toBe(false);
    assertBuilder((builder) => builder.isDateLike(), fields.date, fields.number);
  });

  it('matches cell value type specs', () => {
    const fields = buildFields();
    const cases = [
      {
        spec: FieldIsStringValueSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isStringValue(),
        match: fields.singleText,
        other: fields.number,
      },
      {
        spec: FieldIsNumberValueSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isNumberValue(),
        match: fields.number,
        other: fields.singleText,
      },
      {
        spec: FieldIsBooleanValueSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isBooleanValue(),
        match: fields.checkbox,
        other: fields.singleText,
      },
      {
        spec: FieldIsDateTimeValueSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isDateTimeValue(),
        match: fields.date,
        other: fields.number,
      },
      {
        spec: FieldIsJsonSpec.create(),
        builder: (builder: ReturnType<typeof Field.specs>) => builder.isJson(),
        match: fields.link,
        other: fields.number,
      },
    ];

    for (const entry of cases) {
      assertSpec({ spec: entry.spec, match: entry.match, other: entry.other });
      assertBuilder(entry.builder, entry.match, entry.other);
    }
  });

  it('matches primary field spec', () => {
    const fields = buildFields();
    const primarySpec = FieldIsPrimarySpec.create(fields.link.id());
    assertSpec({ spec: primarySpec, match: fields.link, other: fields.number });
    assertBuilder((builder) => builder.isPrimary(fields.link.id()), fields.link, fields.number);
  });
});
