import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../../base/BaseId';
import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { CellValueMultiplicity } from '../../../fields/types/CellValueMultiplicity';
import { CellValueType } from '../../../fields/types/CellValueType';
import { DateTimeFormatting } from '../../../fields/types/DateTimeFormatting';
import { FieldHasError } from '../../../fields/types/FieldHasError';
import { NumberFormatting } from '../../../fields/types/NumberFormatting';
import { NumberShowAs } from '../../../fields/types/NumberShowAs';
import { RollupField } from '../../../fields/types/RollupField';
import { RollupFieldConfig } from '../../../fields/types/RollupFieldConfig';
import { RollupExpression } from '../../../fields/types/RollupExpression';
import { SingleLineTextShowAs } from '../../../fields/types/SingleLineTextShowAs';
import { TimeZone } from '../../../fields/types/TimeZone';
import { Table } from '../../../Table';
import { TableId } from '../../../TableId';
import { TableName } from '../../../TableName';
import type { ITableSpecVisitor } from '../../ITableSpecVisitor';
import { UpdateRollupConfigSpec } from '../UpdateRollupConfigSpec';
import { UpdateRollupExpressionSpec } from '../UpdateRollupExpressionSpec';
import { UpdateRollupFormattingSpec } from '../UpdateRollupFormattingSpec';
import { UpdateRollupShowAsSpec } from '../UpdateRollupShowAsSpec';
import { UpdateRollupTimeZoneSpec } from '../UpdateRollupTimeZoneSpec';

const normalizeSeed = (seed: string) => (seed + 'x'.repeat(16)).slice(0, 16);
const createBaseId = (seed: string) => BaseId.create(`bse${normalizeSeed(seed)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${normalizeSeed(seed)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${normalizeSeed(seed)}`)._unsafeUnwrap();

const numberFormatting = NumberFormatting.create({
  type: 'decimal',
  precision: 2,
})._unsafeUnwrap();
const percentFormatting = NumberFormatting.create({
  type: 'percent',
  precision: 1,
})._unsafeUnwrap();
const dateFormatting = DateTimeFormatting.default();
const numberShowAs = NumberShowAs.create({
  type: 'bar',
  color: 'blue',
  showValue: true,
  maxValue: 10,
})._unsafeUnwrap();
const textShowAs = SingleLineTextShowAs.create({ type: 'url' })._unsafeUnwrap();
const utcTimeZone = TimeZone.create('utc')._unsafeUnwrap();
const shanghaiTimeZone = TimeZone.create('Asia/Shanghai')._unsafeUnwrap();

const numberResultType = {
  cellValueType: CellValueType.number(),
  isMultipleCellValue: CellValueMultiplicity.single(),
};
const stringResultType = {
  cellValueType: CellValueType.string(),
  isMultipleCellValue: CellValueMultiplicity.single(),
};
const dateTimeResultType = {
  cellValueType: CellValueType.dateTime(),
  isMultipleCellValue: CellValueMultiplicity.single(),
};

const buildConfig = (seed: string) =>
  RollupFieldConfig.create({
    linkFieldId: createFieldId(seed).toString(),
    foreignTableId: createTableId(seed).toString(),
    lookupFieldId: createFieldId(`${seed}x`).toString(),
  })._unsafeUnwrap();

const buildRollupTable = (params: {
  fieldId: FieldId;
  config: RollupFieldConfig;
  expression: RollupExpression;
  resultType?: {
    cellValueType: CellValueType;
    isMultipleCellValue: CellValueMultiplicity;
  };
  formatting?: NumberFormatting | DateTimeFormatting;
  showAs?: NumberShowAs | SingleLineTextShowAs;
  timeZone?: TimeZone;
  hasError?: boolean;
}) => {
  const builder = Table.builder()
    .withBaseId(createBaseId('a'))
    .withId(createTableId('a'))
    .withName(TableName.create('Rollup Table')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(createFieldId('p'))
    .withName(FieldName.create('Primary')._unsafeUnwrap())
    .primary()
    .done();
  const rollupBuilder = builder
    .field()
    .rollup()
    .withId(params.fieldId)
    .withName(FieldName.create('Summary')._unsafeUnwrap())
    .withConfig(params.config)
    .withExpression(params.expression);
  if (params.resultType) {
    rollupBuilder.withResultType(params.resultType);
  }
  if (params.formatting) {
    rollupBuilder.withFormatting(params.formatting);
  }
  if (params.showAs) {
    rollupBuilder.withShowAs(params.showAs);
  }
  if (params.timeZone) {
    rollupBuilder.withTimeZone(params.timeZone);
  }
  rollupBuilder.done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  if (params.hasError) {
    const field = table
      .getField((candidate) => candidate.id().equals(params.fieldId))
      ._unsafeUnwrap();
    field.setHasError(FieldHasError.error());
  }
  return table;
};

const buildNumberTable = (fieldId: FieldId) => {
  const builder = Table.builder()
    .withBaseId(createBaseId('b'))
    .withId(createTableId('b'))
    .withName(TableName.create('Wrong Type Table')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(createFieldId('q'))
    .withName(FieldName.create('Primary')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(fieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('Rollup field update specs', () => {
  describe('UpdateRollupConfigSpec', () => {
    it('mutates pending rollup fields without a resolved result type', () => {
      const fieldId = createFieldId('c');
      const previousConfig = buildConfig('c');
      const nextConfig = buildConfig('d');
      const table = buildRollupTable({
        fieldId,
        config: previousConfig,
        expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
      });

      const spec = UpdateRollupConfigSpec.create(fieldId, previousConfig, nextConfig);
      const result = spec.mutate(table);

      expect(result.isOk()).toBe(true);
      const updatedField = result
        ._unsafeUnwrap()
        .getField((candidate) => candidate.id().equals(fieldId))
        ._unsafeUnwrap() as RollupField;
      expect(updatedField.config().equals(nextConfig)).toBe(true);
      expect(updatedField.cellValueType().isErr()).toBe(true);
    });

    it('mutates resolved rollup fields and preserves their result type', () => {
      const fieldId = createFieldId('e');
      const previousConfig = buildConfig('e');
      const nextConfig = buildConfig('f');
      const table = buildRollupTable({
        fieldId,
        config: previousConfig,
        expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
        resultType: numberResultType,
        formatting: numberFormatting,
        showAs: numberShowAs,
      });

      const spec = UpdateRollupConfigSpec.create(fieldId, previousConfig, nextConfig);
      const result = spec.mutate(table);

      expect(result.isOk()).toBe(true);
      const updatedField = result
        ._unsafeUnwrap()
        .getField((candidate) => candidate.id().equals(fieldId))
        ._unsafeUnwrap() as RollupField;
      expect(updatedField.config().equals(nextConfig)).toBe(true);
      expect(updatedField.cellValueType()._unsafeUnwrap().toString()).toBe('number');
      expect(updatedField.isMultipleCellValue()._unsafeUnwrap().toBoolean()).toBe(false);
    });

    it('errors when has-error rollup fields carry options incompatible with the fallback result type', () => {
      const fieldId = createFieldId('g');
      const previousConfig = buildConfig('g');
      const nextConfig = buildConfig('h');
      const table = buildRollupTable({
        fieldId,
        config: previousConfig,
        expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
        formatting: numberFormatting,
        showAs: numberShowAs,
        hasError: true,
      });

      const spec = UpdateRollupConfigSpec.create(fieldId, previousConfig, nextConfig);
      const result = spec.mutate(table);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Invalid RollupField formatting');
    });

    it('errors when the field is missing or not a rollup field', () => {
      const fieldId = createFieldId('i');
      const previousConfig = buildConfig('i');
      const nextConfig = buildConfig('j');

      const missingFieldTable = buildRollupTable({
        fieldId: createFieldId('k'),
        config: previousConfig,
        expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
      });
      expect(
        UpdateRollupConfigSpec.create(fieldId, previousConfig, nextConfig)
          .mutate(missingFieldTable)
          .isErr()
      ).toBe(true);

      const wrongTypeTable = buildNumberTable(fieldId);
      const wrongTypeResult = UpdateRollupConfigSpec.create(
        fieldId,
        previousConfig,
        nextConfig
      ).mutate(wrongTypeTable);
      expect(wrongTypeResult.isErr()).toBe(true);
      expect(wrongTypeResult._unsafeUnwrapErr().message).toContain('not a rollup field');
    });

    it('accepts the table spec visitor', () => {
      let visited = false;
      const spec = UpdateRollupConfigSpec.create(
        createFieldId('l'),
        buildConfig('l'),
        buildConfig('m')
      );
      const visitor = {
        visitUpdateRollupConfig: () => {
          visited = true;
          return ok(undefined);
        },
      };

      expect(spec.accept(visitor as unknown as ITableSpecVisitor<void>).isOk()).toBe(true);
      expect(visited).toBe(true);
    });
  });

  describe('UpdateRollupExpressionSpec', () => {
    it('mutates pending rollup fields without a resolved result type', () => {
      const fieldId = createFieldId('n');
      const table = buildRollupTable({
        fieldId,
        config: buildConfig('n'),
        expression: RollupExpression.create('array_join({values})')._unsafeUnwrap(),
      });
      const previousExpression = RollupExpression.create('array_join({values})')._unsafeUnwrap();
      const nextExpression = RollupExpression.create('concatenate({values})')._unsafeUnwrap();

      const spec = UpdateRollupExpressionSpec.create(fieldId, previousExpression, nextExpression);
      const result = spec.mutate(table);

      expect(result.isOk()).toBe(true);
      const updatedField = result
        ._unsafeUnwrap()
        .getField((candidate) => candidate.id().equals(fieldId))
        ._unsafeUnwrap() as RollupField;
      expect(updatedField.expression().equals(nextExpression)).toBe(true);
      expect(updatedField.cellValueType().isErr()).toBe(true);
    });

    it('mutates resolved rollup fields and preserves their result type', () => {
      const fieldId = createFieldId('o');
      const previousExpression = RollupExpression.create('sum({values})')._unsafeUnwrap();
      const nextExpression = RollupExpression.create('average({values})')._unsafeUnwrap();
      const table = buildRollupTable({
        fieldId,
        config: buildConfig('o'),
        expression: previousExpression,
        resultType: numberResultType,
        formatting: numberFormatting,
        showAs: numberShowAs,
      });

      const spec = UpdateRollupExpressionSpec.create(fieldId, previousExpression, nextExpression);
      const result = spec.mutate(table);

      expect(result.isOk()).toBe(true);
      const updatedField = result
        ._unsafeUnwrap()
        .getField((candidate) => candidate.id().equals(fieldId))
        ._unsafeUnwrap() as RollupField;
      expect(updatedField.expression().equals(nextExpression)).toBe(true);
      expect(updatedField.cellValueType()._unsafeUnwrap().toString()).toBe('number');
    });

    it('errors when has-error rollup fields carry options incompatible with the fallback result type', () => {
      const fieldId = createFieldId('pa');
      const previousExpression = RollupExpression.create('sum({values})')._unsafeUnwrap();
      const nextExpression = RollupExpression.create('average({values})')._unsafeUnwrap();
      const table = buildRollupTable({
        fieldId,
        config: buildConfig('pa'),
        expression: previousExpression,
        formatting: numberFormatting,
        showAs: numberShowAs,
        hasError: true,
      });

      const spec = UpdateRollupExpressionSpec.create(fieldId, previousExpression, nextExpression);
      const result = spec.mutate(table);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Invalid RollupField formatting');
    });

    it('errors when the field is missing or not a rollup field', () => {
      const fieldId = createFieldId('r');
      const previousExpression = RollupExpression.create('sum({values})')._unsafeUnwrap();
      const nextExpression = RollupExpression.create('average({values})')._unsafeUnwrap();

      const missingFieldTable = buildRollupTable({
        fieldId: createFieldId('s'),
        config: buildConfig('r'),
        expression: previousExpression,
      });
      expect(
        UpdateRollupExpressionSpec.create(fieldId, previousExpression, nextExpression)
          .mutate(missingFieldTable)
          .isErr()
      ).toBe(true);

      const wrongTypeTable = buildNumberTable(fieldId);
      const wrongTypeResult = UpdateRollupExpressionSpec.create(
        fieldId,
        previousExpression,
        nextExpression
      ).mutate(wrongTypeTable);
      expect(wrongTypeResult.isErr()).toBe(true);
      expect(wrongTypeResult._unsafeUnwrapErr().message).toContain('not a rollup field');
    });

    it('accepts the table spec visitor', () => {
      let visited = false;
      const spec = UpdateRollupExpressionSpec.create(
        createFieldId('t'),
        RollupExpression.create('sum({values})')._unsafeUnwrap(),
        RollupExpression.create('average({values})')._unsafeUnwrap()
      );
      const visitor = {
        visitUpdateRollupExpression: () => {
          visited = true;
          return ok(undefined);
        },
      };

      expect(spec.accept(visitor as unknown as ITableSpecVisitor<void>).isOk()).toBe(true);
      expect(visited).toBe(true);
    });
  });

  describe('UpdateRollupFormattingSpec', () => {
    it('mutates the rollup formatting when the result type is set', () => {
      const fieldId = createFieldId('u');
      const table = buildRollupTable({
        fieldId,
        config: buildConfig('u'),
        expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
        resultType: numberResultType,
        formatting: numberFormatting,
        showAs: numberShowAs,
      });
      const spec = UpdateRollupFormattingSpec.create(fieldId, numberFormatting, percentFormatting);

      const result = spec.mutate(table);

      expect(result.isOk()).toBe(true);
      const updatedField = result
        ._unsafeUnwrap()
        .getField((candidate) => candidate.id().equals(fieldId))
        ._unsafeUnwrap() as RollupField;
      expect(updatedField.formatting()).toEqual(percentFormatting);
    });

    it('errors when the result type is missing', () => {
      const fieldId = createFieldId('v');
      const table = buildRollupTable({
        fieldId,
        config: buildConfig('v'),
        expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
      });
      const spec = UpdateRollupFormattingSpec.create(fieldId, undefined, percentFormatting);

      const result = spec.mutate(table);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('result type not set');
    });

    it('errors when the next formatting is incompatible with the result type', () => {
      const fieldId = createFieldId('w');
      const table = buildRollupTable({
        fieldId,
        config: buildConfig('w'),
        expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
        resultType: numberResultType,
        formatting: numberFormatting,
        showAs: numberShowAs,
      });
      const spec = UpdateRollupFormattingSpec.create(fieldId, numberFormatting, dateFormatting);

      const result = spec.mutate(table);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Invalid RollupField formatting');
    });

    it('errors when the field is missing or not a rollup field', () => {
      const fieldId = createFieldId('x');
      const spec = UpdateRollupFormattingSpec.create(fieldId, undefined, percentFormatting);

      const missingFieldTable = buildRollupTable({
        fieldId: createFieldId('y'),
        config: buildConfig('x'),
        expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
        resultType: numberResultType,
      });
      expect(spec.mutate(missingFieldTable).isErr()).toBe(true);

      const wrongTypeResult = spec.mutate(buildNumberTable(fieldId));
      expect(wrongTypeResult.isErr()).toBe(true);
      expect(wrongTypeResult._unsafeUnwrapErr().message).toContain('not a rollup field');
    });

    it('accepts the table spec visitor', () => {
      let visited = false;
      const spec = UpdateRollupFormattingSpec.create(
        createFieldId('z'),
        numberFormatting,
        percentFormatting
      );
      const visitor = {
        visitUpdateRollupFormatting: () => {
          visited = true;
          return ok(undefined);
        },
      };

      expect(spec.accept(visitor as unknown as ITableSpecVisitor<void>).isOk()).toBe(true);
      expect(visited).toBe(true);
    });
  });

  describe('UpdateRollupShowAsSpec', () => {
    it('mutates the rollup showAs when the result type is set', () => {
      const fieldId = createFieldId('aa');
      const previousShowAs = SingleLineTextShowAs.create({ type: 'email' })._unsafeUnwrap();
      const table = buildRollupTable({
        fieldId,
        config: buildConfig('aa'),
        expression: RollupExpression.create('array_join({values})')._unsafeUnwrap(),
        resultType: stringResultType,
        showAs: previousShowAs,
      });
      const spec = UpdateRollupShowAsSpec.create(fieldId, previousShowAs, textShowAs);

      const result = spec.mutate(table);

      expect(result.isOk()).toBe(true);
      const updatedField = result
        ._unsafeUnwrap()
        .getField((candidate) => candidate.id().equals(fieldId))
        ._unsafeUnwrap() as RollupField;
      expect(updatedField.showAs()).toEqual(textShowAs);
    });

    it('errors when the result type is missing', () => {
      const fieldId = createFieldId('ab');
      const table = buildRollupTable({
        fieldId,
        config: buildConfig('ab'),
        expression: RollupExpression.create('array_join({values})')._unsafeUnwrap(),
      });
      const spec = UpdateRollupShowAsSpec.create(fieldId, undefined, textShowAs);

      const result = spec.mutate(table);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('result type not set');
    });

    it('errors when the next showAs is incompatible with the result type', () => {
      const fieldId = createFieldId('ac');
      const table = buildRollupTable({
        fieldId,
        config: buildConfig('ac'),
        expression: RollupExpression.create('max({values})')._unsafeUnwrap(),
        resultType: dateTimeResultType,
        formatting: dateFormatting,
        timeZone: utcTimeZone,
      });
      const spec = UpdateRollupShowAsSpec.create(fieldId, undefined, textShowAs);

      const result = spec.mutate(table);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Invalid RollupField showAs');
    });

    it('errors when the field is missing or not a rollup field', () => {
      const fieldId = createFieldId('ad');
      const spec = UpdateRollupShowAsSpec.create(fieldId, undefined, textShowAs);

      const missingFieldTable = buildRollupTable({
        fieldId: createFieldId('ae'),
        config: buildConfig('ad'),
        expression: RollupExpression.create('array_join({values})')._unsafeUnwrap(),
        resultType: stringResultType,
      });
      expect(spec.mutate(missingFieldTable).isErr()).toBe(true);

      const wrongTypeResult = spec.mutate(buildNumberTable(fieldId));
      expect(wrongTypeResult.isErr()).toBe(true);
      expect(wrongTypeResult._unsafeUnwrapErr().message).toContain('not a rollup field');
    });

    it('accepts the table spec visitor', () => {
      let visited = false;
      const spec = UpdateRollupShowAsSpec.create(createFieldId('af'), undefined, textShowAs);
      const visitor = {
        visitUpdateRollupShowAs: () => {
          visited = true;
          return ok(undefined);
        },
      };

      expect(spec.accept(visitor as unknown as ITableSpecVisitor<void>).isOk()).toBe(true);
      expect(visited).toBe(true);
    });
  });

  describe('UpdateRollupTimeZoneSpec', () => {
    it('mutates the rollup time zone when the result type is set', () => {
      const fieldId = createFieldId('ag');
      const table = buildRollupTable({
        fieldId,
        config: buildConfig('ag'),
        expression: RollupExpression.create('max({values})')._unsafeUnwrap(),
        resultType: dateTimeResultType,
        formatting: dateFormatting,
        timeZone: utcTimeZone,
      });
      const spec = UpdateRollupTimeZoneSpec.create(fieldId, utcTimeZone, shanghaiTimeZone);

      const result = spec.mutate(table);

      expect(result.isOk()).toBe(true);
      const updatedField = result
        ._unsafeUnwrap()
        .getField((candidate) => candidate.id().equals(fieldId))
        ._unsafeUnwrap() as RollupField;
      expect(updatedField.timeZone()).toEqual(shanghaiTimeZone);
    });

    it('errors when the result type is missing', () => {
      const fieldId = createFieldId('ah');
      const table = buildRollupTable({
        fieldId,
        config: buildConfig('ah'),
        expression: RollupExpression.create('max({values})')._unsafeUnwrap(),
      });
      const spec = UpdateRollupTimeZoneSpec.create(fieldId, undefined, utcTimeZone);

      const result = spec.mutate(table);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('result type not set');
    });

    it('errors when the field is missing or not a rollup field', () => {
      const fieldId = createFieldId('ai');
      const spec = UpdateRollupTimeZoneSpec.create(fieldId, undefined, utcTimeZone);

      const missingFieldTable = buildRollupTable({
        fieldId: createFieldId('aj'),
        config: buildConfig('ai'),
        expression: RollupExpression.create('max({values})')._unsafeUnwrap(),
        resultType: dateTimeResultType,
        formatting: dateFormatting,
      });
      expect(spec.mutate(missingFieldTable).isErr()).toBe(true);

      const wrongTypeResult = spec.mutate(buildNumberTable(fieldId));
      expect(wrongTypeResult.isErr()).toBe(true);
      expect(wrongTypeResult._unsafeUnwrapErr().message).toContain('not a rollup field');
    });

    it('accepts the table spec visitor', () => {
      let visited = false;
      const spec = UpdateRollupTimeZoneSpec.create(createFieldId('ak'), undefined, utcTimeZone);
      const visitor = {
        visitUpdateRollupTimeZone: () => {
          visited = true;
          return ok(undefined);
        },
      };

      expect(spec.accept(visitor as unknown as ITableSpecVisitor<void>).isOk()).toBe(true);
      expect(visited).toBe(true);
    });
  });
});
