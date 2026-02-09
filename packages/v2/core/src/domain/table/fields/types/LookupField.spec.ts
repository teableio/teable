import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import type { DomainError } from '../../../shared/DomainError';
import { Table } from '../../Table';
import { TableId } from '../../TableId';
import { TableName } from '../../TableName';
import type { Field } from '../Field';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { FieldType, type fieldTypeValues } from '../FieldType';
import { AttachmentField } from './AttachmentField';
import { AutoNumberField } from './AutoNumberField';
import { ButtonField } from './ButtonField';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import { CheckboxField } from './CheckboxField';
import { ConditionalLookupField } from './ConditionalLookupField';
import { ConditionalLookupOptions } from './ConditionalLookupOptions';
import { ConditionalRollupConfig } from './ConditionalRollupConfig';
import { ConditionalRollupField } from './ConditionalRollupField';
import { CreatedByField } from './CreatedByField';
import { CreatedTimeField } from './CreatedTimeField';
import { DateField } from './DateField';
import { FormulaExpression } from './FormulaExpression';
import { FormulaField } from './FormulaField';
import { LastModifiedByField } from './LastModifiedByField';
import { LastModifiedTimeField } from './LastModifiedTimeField';
import { LinkField } from './LinkField';
import { LinkFieldConfig } from './LinkFieldConfig';
import { LinkRelationship } from './LinkRelationship';
import { LongTextField } from './LongTextField';
import { LookupField } from './LookupField';
import { LookupOptions } from './LookupOptions';
import { MultipleSelectField } from './MultipleSelectField';
import { NumberField } from './NumberField';
import { NumberFormatting, NumberFormattingType } from './NumberFormatting';
import { RatingField } from './RatingField';
import { RollupExpression } from './RollupExpression';
import { RollupField } from './RollupField';
import { RollupFieldConfig } from './RollupFieldConfig';
import { SelectOption } from './SelectOption';
import { SingleLineTextField } from './SingleLineTextField';
import { SingleSelectField } from './SingleSelectField';
import { UserField } from './UserField';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`);
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

// ============================================================================
// Type-safe field factory matrix
// ============================================================================

/**
 * Field type literal values - must match fieldTypeValues from FieldType.ts
 * TypeScript will error if fieldTypeValues changes and this doesn't match.
 */
type FieldTypeLiteral = (typeof fieldTypeValues)[number];

/**
 * Field factory function type
 */
type FieldFactory = (id: FieldId, name: FieldName) => Result<Field, DomainError>;

/**
 * Expected cell value type for each field type
 */
type ExpectedCellValueType = 'string' | 'number' | 'boolean' | 'dateTime';

/**
 * Test case definition for inner field type
 */
interface InnerFieldTestCase {
  type: FieldTypeLiteral;
  factory: FieldFactory;
  expectedCellValueType: ExpectedCellValueType;
}

/**
 * Create a type-safe map that requires ALL field types to be covered.
 * If a new field type is added to fieldTypeValues, TypeScript will error here
 * because the record will be missing a key.
 */
const createInnerFieldFactories = (): Record<FieldTypeLiteral, InnerFieldTestCase> => {
  const numberFormatting = NumberFormatting.create({
    type: NumberFormattingType.Decimal,
    precision: 2,
  })._unsafeUnwrap();

  const selectOption = SelectOption.create({
    name: 'Option1',
    color: 'blue',
  })._unsafeUnwrap();

  // Link field requires special setup
  const linkFieldConfig = LinkFieldConfig.create({
    relationship: LinkRelationship.manyMany().toString(),
    foreignTableId: createTableId('z')._unsafeUnwrap().toString(),
    lookupFieldId: createFieldId('y')._unsafeUnwrap().toString(),
    fkHostTableName: 'junction',
    selfKeyName: '__id',
    foreignKeyName: '__fk',
  })._unsafeUnwrap();

  // Rollup field requires special setup
  const rollupConfig = RollupFieldConfig.create({
    linkFieldId: createFieldId('w')._unsafeUnwrap().toString(),
    foreignTableId: createTableId('v')._unsafeUnwrap().toString(),
    lookupFieldId: createFieldId('u')._unsafeUnwrap().toString(),
  })._unsafeUnwrap();

  const rollupExpression = RollupExpression.create('countall({values})')._unsafeUnwrap();

  // Formula field requires resultType to be set
  const formulaExpression = FormulaExpression.create('1+1')._unsafeUnwrap();

  // Lookup field (for nested lookup test)
  const lookupOptions = LookupOptions.create({
    linkFieldId: createFieldId('t')._unsafeUnwrap().toString(),
    foreignTableId: createTableId('s')._unsafeUnwrap().toString(),
    lookupFieldId: createFieldId('r')._unsafeUnwrap().toString(),
  })._unsafeUnwrap();

  return {
    singleLineText: {
      type: 'singleLineText',
      factory: (id, name) => SingleLineTextField.create({ id, name }),
      expectedCellValueType: 'string',
    },
    longText: {
      type: 'longText',
      factory: (id, name) => LongTextField.create({ id, name }),
      expectedCellValueType: 'string',
    },
    number: {
      type: 'number',
      factory: (id, name) => NumberField.create({ id, name, formatting: numberFormatting }),
      expectedCellValueType: 'number',
    },
    rating: {
      type: 'rating',
      factory: (id, name) => RatingField.create({ id, name }),
      expectedCellValueType: 'number',
    },
    formula: {
      type: 'formula',
      factory: (id, name) =>
        FormulaField.create({
          id,
          name,
          expression: formulaExpression,
          resultType: {
            cellValueType: CellValueType.number(),
            isMultipleCellValue: CellValueMultiplicity.single(),
          },
        }),
      expectedCellValueType: 'number',
    },
    rollup: {
      type: 'rollup',
      factory: (id, name) => {
        // Rollup needs a valuesField to resolve result type
        const valuesFieldId = createFieldId('q')._unsafeUnwrap();
        const valuesFieldName = FieldName.create('Values')._unsafeUnwrap();
        const valuesField = SingleLineTextField.create({
          id: valuesFieldId,
          name: valuesFieldName,
        })._unsafeUnwrap();
        return RollupField.create({
          id,
          name,
          config: rollupConfig,
          expression: rollupExpression,
          valuesField,
        });
      },
      expectedCellValueType: 'number', // countall returns number
    },
    lookup: {
      type: 'lookup',
      factory: (id, name) => {
        // Create a nested lookup - the inner field is another lookup
        const nestedInnerFieldId = createFieldId('p')._unsafeUnwrap();
        const nestedInnerFieldName = FieldName.create('Nested Inner')._unsafeUnwrap();
        const nestedInnerField = SingleLineTextField.create({
          id: nestedInnerFieldId,
          name: nestedInnerFieldName,
        })._unsafeUnwrap();
        return LookupField.create({
          id,
          name,
          innerField: nestedInnerField,
          lookupOptions,
        });
      },
      expectedCellValueType: 'string',
    },
    singleSelect: {
      type: 'singleSelect',
      factory: (id, name) => SingleSelectField.create({ id, name, options: [selectOption] }),
      expectedCellValueType: 'string',
    },
    multipleSelect: {
      type: 'multipleSelect',
      factory: (id, name) => MultipleSelectField.create({ id, name, options: [selectOption] }),
      expectedCellValueType: 'string',
    },
    checkbox: {
      type: 'checkbox',
      factory: (id, name) => CheckboxField.create({ id, name }),
      expectedCellValueType: 'boolean',
    },
    attachment: {
      type: 'attachment',
      factory: (id, name) => AttachmentField.create({ id, name }),
      expectedCellValueType: 'string',
    },
    date: {
      type: 'date',
      factory: (id, name) => DateField.create({ id, name }),
      expectedCellValueType: 'dateTime',
    },
    createdTime: {
      type: 'createdTime',
      factory: (id, name) => CreatedTimeField.create({ id, name }),
      expectedCellValueType: 'dateTime',
    },
    lastModifiedTime: {
      type: 'lastModifiedTime',
      factory: (id, name) => LastModifiedTimeField.create({ id, name }),
      expectedCellValueType: 'dateTime',
    },
    user: {
      type: 'user',
      factory: (id, name) => UserField.create({ id, name }),
      expectedCellValueType: 'string',
    },
    createdBy: {
      type: 'createdBy',
      factory: (id, name) => CreatedByField.create({ id, name }),
      expectedCellValueType: 'string',
    },
    lastModifiedBy: {
      type: 'lastModifiedBy',
      factory: (id, name) => LastModifiedByField.create({ id, name }),
      expectedCellValueType: 'string',
    },
    autoNumber: {
      type: 'autoNumber',
      factory: (id, name) => AutoNumberField.create({ id, name }),
      expectedCellValueType: 'number',
    },
    button: {
      type: 'button',
      factory: (id, name) => ButtonField.create({ id, name }),
      expectedCellValueType: 'string',
    },
    link: {
      type: 'link',
      factory: (id, name) => LinkField.create({ id, name, config: linkFieldConfig }),
      expectedCellValueType: 'string',
    },
    conditionalRollup: {
      type: 'conditionalRollup',
      factory: (id, name) => {
        // ConditionalRollup needs config and valuesField
        // Use single-character seeds to produce 16-character bodies
        const valuesFieldId = createFieldId('1')._unsafeUnwrap();
        const valuesFieldName = FieldName.create('CR Values')._unsafeUnwrap();
        const valuesField = SingleLineTextField.create({
          id: valuesFieldId,
          name: valuesFieldName,
        })._unsafeUnwrap();
        // Create a dummy field ID for the filter condition (condition must have at least one filter item)
        const filterFieldId = createFieldId('7')._unsafeUnwrap();
        const conditionalRollupConfig = ConditionalRollupConfig.create({
          foreignTableId: createTableId('2')._unsafeUnwrap().toString(),
          lookupFieldId: createFieldId('3')._unsafeUnwrap().toString(),
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: filterFieldId.toString(),
                  operator: 'isNotEmpty',
                },
              ],
            },
          },
        })._unsafeUnwrap();
        return ConditionalRollupField.create({
          id,
          name,
          config: conditionalRollupConfig,
          expression: rollupExpression,
          valuesField,
        });
      },
      expectedCellValueType: 'number',
    },
    conditionalLookup: {
      type: 'conditionalLookup',
      factory: (id, name) => {
        // Use single-character seeds to produce 16-character bodies
        const innerFieldId = createFieldId('4')._unsafeUnwrap();
        const innerFieldName = FieldName.create('CL Inner')._unsafeUnwrap();
        const innerField = SingleLineTextField.create({
          id: innerFieldId,
          name: innerFieldName,
        })._unsafeUnwrap();
        // Create a dummy field ID for the filter condition (condition must have at least one filter item)
        const filterFieldId = createFieldId('8')._unsafeUnwrap();
        const conditionalLookupOptions = ConditionalLookupOptions.create({
          foreignTableId: createTableId('5')._unsafeUnwrap().toString(),
          lookupFieldId: createFieldId('6')._unsafeUnwrap().toString(),
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: filterFieldId.toString(),
                  operator: 'isNotEmpty',
                },
              ],
            },
          },
        })._unsafeUnwrap();
        return ConditionalLookupField.create({
          id,
          name,
          innerField,
          conditionalLookupOptions,
        });
      },
      expectedCellValueType: 'string',
    },
  };
};

/**
 * Compile-time check: Ensure all field types are covered.
 * This line will cause a TypeScript error if any field type is missing from the factory map.
 */
const _exhaustiveCheck: Record<FieldTypeLiteral, InnerFieldTestCase> = createInnerFieldFactories();
// Use the variable to avoid unused variable warning
void _exhaustiveCheck;

/**
 * Get all inner field test cases as an array for it.each
 */
const getInnerFieldTestCases = (): InnerFieldTestCase[] => {
  return Object.values(createInnerFieldFactories());
};

/**
 * Map expected cell value type string to CellValueType
 */
const expectedToCellValueType = (expected: ExpectedCellValueType): CellValueType => {
  switch (expected) {
    case 'string':
      return CellValueType.string();
    case 'number':
      return CellValueType.number();
    case 'boolean':
      return CellValueType.boolean();
    case 'dateTime':
      return CellValueType.dateTime();
  }
};

describe('LookupField', () => {
  describe('creation', () => {
    it('creates a lookup field with valid inner field and options', () => {
      const fieldIdResult = createFieldId('a');
      const innerFieldIdResult = createFieldId('b');
      const linkFieldIdResult = createFieldId('c');
      const foreignTableIdResult = createTableId('d');
      const lookupFieldIdResult = createFieldId('e');
      const fieldNameResult = FieldName.create('Lookup Name');
      const innerFieldNameResult = FieldName.create('Inner');

      const innerFieldResult = SingleLineTextField.create({
        id: innerFieldIdResult._unsafeUnwrap(),
        name: innerFieldNameResult._unsafeUnwrap(),
      });

      const lookupOptionsResult = LookupOptions.create({
        linkFieldId: linkFieldIdResult._unsafeUnwrap().toString(),
        foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
        lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      });

      const lookupFieldResult = LookupField.create({
        id: fieldIdResult._unsafeUnwrap(),
        name: fieldNameResult._unsafeUnwrap(),
        innerField: innerFieldResult._unsafeUnwrap(),
        lookupOptions: lookupOptionsResult._unsafeUnwrap(),
      });

      expect(lookupFieldResult.isOk()).toBe(true);
      const lookupField = lookupFieldResult._unsafeUnwrap();

      expect(lookupField.id().equals(fieldIdResult._unsafeUnwrap())).toBe(true);
      expect(lookupField.name().toString()).toBe('Lookup Name');
      expect(lookupField.type().equals(FieldType.lookup())).toBe(true);
      expect(lookupField.linkFieldId().equals(linkFieldIdResult._unsafeUnwrap())).toBe(true);
      expect(lookupField.foreignTableId().equals(foreignTableIdResult._unsafeUnwrap())).toBe(true);
      expect(lookupField.lookupFieldId().equals(lookupFieldIdResult._unsafeUnwrap())).toBe(true);
    });

    it('supports nested lookup fields', () => {
      const outerFieldIdResult = createFieldId('f');
      const innerFieldIdResult = createFieldId('g');
      const nestedInnerFieldIdResult = createFieldId('h');
      const linkFieldIdResult = createFieldId('i');
      const foreignTableIdResult = createTableId('j');
      const lookupFieldIdResult = createFieldId('k');
      const outerFieldNameResult = FieldName.create('Outer Lookup');
      const innerFieldNameResult = FieldName.create('Inner Lookup');
      const nestedInnerFieldNameResult = FieldName.create('Nested Inner');

      // Create the innermost actual field (SingleLineText)
      const nestedInnerFieldResult = SingleLineTextField.create({
        id: nestedInnerFieldIdResult._unsafeUnwrap(),
        name: nestedInnerFieldNameResult._unsafeUnwrap(),
      });

      const lookupOptionsResult = LookupOptions.create({
        linkFieldId: linkFieldIdResult._unsafeUnwrap().toString(),
        foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
        lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      });

      // Create inner lookup field
      const innerLookupFieldResult = LookupField.create({
        id: innerFieldIdResult._unsafeUnwrap(),
        name: innerFieldNameResult._unsafeUnwrap(),
        innerField: nestedInnerFieldResult._unsafeUnwrap(),
        lookupOptions: lookupOptionsResult._unsafeUnwrap(),
      });

      // Create outer lookup with another lookup as inner field - this should succeed
      const outerLookupFieldResult = LookupField.create({
        id: outerFieldIdResult._unsafeUnwrap(),
        name: outerFieldNameResult._unsafeUnwrap(),
        innerField: innerLookupFieldResult._unsafeUnwrap(),
        lookupOptions: lookupOptionsResult._unsafeUnwrap(),
      });

      // Nested lookups are supported for cross-table lookups (Table A -> Table B -> Table C)
      expect(outerLookupFieldResult.isOk()).toBe(true);
      const outerLookup = outerLookupFieldResult._unsafeUnwrap();
      expect(outerLookup.type().equals(FieldType.lookup())).toBe(true);
    });
  });

  describe('inner field types matrix', () => {
    const testCases = getInnerFieldTestCases();

    it.each(testCases)(
      'creates lookup field with $type inner field',
      ({ type, factory, expectedCellValueType }) => {
        const lookupFieldId = createFieldId('a')._unsafeUnwrap();
        const innerFieldId = createFieldId('b')._unsafeUnwrap();
        const linkFieldId = createFieldId('c')._unsafeUnwrap();
        const foreignTableId = createTableId('d')._unsafeUnwrap();
        const lookupTargetFieldId = createFieldId('e')._unsafeUnwrap();

        const lookupFieldName = FieldName.create(`Lookup ${type}`)._unsafeUnwrap();
        const innerFieldName = FieldName.create(`Inner ${type}`)._unsafeUnwrap();

        // Create inner field using the factory
        const innerFieldResult = factory(innerFieldId, innerFieldName);
        expect(innerFieldResult.isOk()).toBe(true);
        const innerField = innerFieldResult._unsafeUnwrap();

        // Verify the inner field has the correct type
        expect(innerField.type().equals(FieldType.create(type)._unsafeUnwrap())).toBe(true);

        // Create lookup options
        const lookupOptions = LookupOptions.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupTargetFieldId.toString(),
        })._unsafeUnwrap();

        // Create lookup field with the inner field
        const lookupFieldResult = LookupField.create({
          id: lookupFieldId,
          name: lookupFieldName,
          innerField,
          lookupOptions,
        });

        expect(lookupFieldResult.isOk()).toBe(true);
        const lookupField = lookupFieldResult._unsafeUnwrap();

        // Verify lookup field properties
        expect(lookupField.type().equals(FieldType.lookup())).toBe(true);
        expect(lookupField.computed().toBoolean()).toBe(true);

        // Verify lookupOptions are correct via shortcut methods
        expect(lookupField.linkFieldId().equals(linkFieldId)).toBe(true);
        expect(lookupField.foreignTableId().equals(foreignTableId)).toBe(true);
        expect(lookupField.lookupFieldId().equals(lookupTargetFieldId)).toBe(true);

        // Verify lookupOptions() returns correct LookupOptions object
        const retrievedOptions = lookupField.lookupOptions();
        expect(retrievedOptions.linkFieldId().equals(linkFieldId)).toBe(true);
        expect(retrievedOptions.foreignTableId().equals(foreignTableId)).toBe(true);
        expect(retrievedOptions.lookupFieldId().equals(lookupTargetFieldId)).toBe(true);
        expect(retrievedOptions.equals(lookupOptions)).toBe(true);

        // Verify lookupOptionsDto returns correct values
        const optionsDto = lookupField.lookupOptionsDto();
        expect(optionsDto.linkFieldId).toBe(linkFieldId.toString());
        expect(optionsDto.foreignTableId).toBe(foreignTableId.toString());
        expect(optionsDto.lookupFieldId).toBe(lookupTargetFieldId.toString());

        // Verify lookupOptions().toDto() matches lookupOptionsDto()
        const optionsDtoFromOptions = retrievedOptions.toDto();
        expect(optionsDtoFromOptions.linkFieldId).toBe(optionsDto.linkFieldId);
        expect(optionsDtoFromOptions.foreignTableId).toBe(optionsDto.foreignTableId);
        expect(optionsDtoFromOptions.lookupFieldId).toBe(optionsDto.lookupFieldId);

        // Verify inner field is accessible and has correct type
        const retrievedInnerFieldResult = lookupField.innerField();
        expect(retrievedInnerFieldResult.isOk()).toBe(true);
        expect(
          retrievedInnerFieldResult
            ._unsafeUnwrap()
            .type()
            .equals(FieldType.create(type)._unsafeUnwrap())
        ).toBe(true);

        // Verify cell value type matches inner field's expected type
        const cellValueTypeResult = lookupField.cellValueType();
        expect(cellValueTypeResult.isOk()).toBe(true);
        expect(
          cellValueTypeResult._unsafeUnwrap().equals(expectedToCellValueType(expectedCellValueType))
        ).toBe(true);

        // Lookup is always multiple
        const isMultipleResult = lookupField.isMultipleCellValue();
        expect(isMultipleResult.isOk()).toBe(true);
        expect(isMultipleResult._unsafeUnwrap().toBoolean()).toBe(true);
      }
    );
  });

  describe('inner field', () => {
    it('returns the inner field', () => {
      const fieldIdResult = createFieldId('l');
      const innerFieldIdResult = createFieldId('m');
      const linkFieldIdResult = createFieldId('n');
      const foreignTableIdResult = createTableId('o');
      const lookupFieldIdResult = createFieldId('p');
      const fieldNameResult = FieldName.create('Lookup');
      const innerFieldNameResult = FieldName.create('Inner');

      const innerFieldResult = SingleLineTextField.create({
        id: innerFieldIdResult._unsafeUnwrap(),
        name: innerFieldNameResult._unsafeUnwrap(),
      });

      const lookupOptionsResult = LookupOptions.create({
        linkFieldId: linkFieldIdResult._unsafeUnwrap().toString(),
        foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
        lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      });

      const lookupFieldResult = LookupField.create({
        id: fieldIdResult._unsafeUnwrap(),
        name: fieldNameResult._unsafeUnwrap(),
        innerField: innerFieldResult._unsafeUnwrap(),
        lookupOptions: lookupOptionsResult._unsafeUnwrap(),
      });

      const lookupField = lookupFieldResult._unsafeUnwrap();
      const innerField = lookupField.innerField()._unsafeUnwrap();
      expect(innerField.id().equals(innerFieldIdResult._unsafeUnwrap())).toBe(true);
      const innerType = lookupField.innerFieldType()._unsafeUnwrap();
      expect(innerType.equals(FieldType.singleLineText())).toBe(true);
    });
  });

  describe('cell value type', () => {
    it('returns string for text inner field', () => {
      const fieldIdResult = createFieldId('q');
      const innerFieldIdResult = createFieldId('r');
      const linkFieldIdResult = createFieldId('s');
      const foreignTableIdResult = createTableId('t');
      const lookupFieldIdResult = createFieldId('u');
      const fieldNameResult = FieldName.create('Lookup');
      const innerFieldNameResult = FieldName.create('Inner');

      const innerFieldResult = SingleLineTextField.create({
        id: innerFieldIdResult._unsafeUnwrap(),
        name: innerFieldNameResult._unsafeUnwrap(),
      });

      const lookupOptionsResult = LookupOptions.create({
        linkFieldId: linkFieldIdResult._unsafeUnwrap().toString(),
        foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
        lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      });

      const lookupFieldResult = LookupField.create({
        id: fieldIdResult._unsafeUnwrap(),
        name: fieldNameResult._unsafeUnwrap(),
        innerField: innerFieldResult._unsafeUnwrap(),
        lookupOptions: lookupOptionsResult._unsafeUnwrap(),
      });

      const cellValueTypeResult = lookupFieldResult._unsafeUnwrap().cellValueType();
      expect(cellValueTypeResult.isOk()).toBe(true);
      expect(cellValueTypeResult._unsafeUnwrap().equals(CellValueType.string())).toBe(true);
    });

    it('returns number for number inner field', () => {
      const fieldIdResult = createFieldId('v');
      const innerFieldIdResult = createFieldId('w');
      const linkFieldIdResult = createFieldId('x');
      const foreignTableIdResult = createTableId('y');
      const lookupFieldIdResult = createFieldId('z');
      const fieldNameResult = FieldName.create('Lookup');
      const innerFieldNameResult = FieldName.create('Inner Number');

      const formattingResult = NumberFormatting.create({
        type: NumberFormattingType.Decimal,
        precision: 2,
      });

      const innerFieldResult = NumberField.create({
        id: innerFieldIdResult._unsafeUnwrap(),
        name: innerFieldNameResult._unsafeUnwrap(),
        formatting: formattingResult._unsafeUnwrap(),
      });

      const lookupOptionsResult = LookupOptions.create({
        linkFieldId: linkFieldIdResult._unsafeUnwrap().toString(),
        foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
        lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      });

      const lookupFieldResult = LookupField.create({
        id: fieldIdResult._unsafeUnwrap(),
        name: fieldNameResult._unsafeUnwrap(),
        innerField: innerFieldResult._unsafeUnwrap(),
        lookupOptions: lookupOptionsResult._unsafeUnwrap(),
      });

      const cellValueTypeResult = lookupFieldResult._unsafeUnwrap().cellValueType();
      expect(cellValueTypeResult.isOk()).toBe(true);
      expect(cellValueTypeResult._unsafeUnwrap().equals(CellValueType.number())).toBe(true);
    });

    it('always returns multiple cell value', () => {
      const fieldIdResult = createFieldId('1');
      const innerFieldIdResult = createFieldId('2');
      const linkFieldIdResult = createFieldId('3');
      const foreignTableIdResult = createTableId('4');
      const lookupFieldIdResult = createFieldId('5');
      const fieldNameResult = FieldName.create('Lookup');
      const innerFieldNameResult = FieldName.create('Inner');

      const innerFieldResult = SingleLineTextField.create({
        id: innerFieldIdResult._unsafeUnwrap(),
        name: innerFieldNameResult._unsafeUnwrap(),
      });

      const lookupOptionsResult = LookupOptions.create({
        linkFieldId: linkFieldIdResult._unsafeUnwrap().toString(),
        foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
        lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      });

      const lookupFieldResult = LookupField.create({
        id: fieldIdResult._unsafeUnwrap(),
        name: fieldNameResult._unsafeUnwrap(),
        innerField: innerFieldResult._unsafeUnwrap(),
        lookupOptions: lookupOptionsResult._unsafeUnwrap(),
      });

      const isMultipleResult = lookupFieldResult._unsafeUnwrap().isMultipleCellValue();
      expect(isMultipleResult.isOk()).toBe(true);
      expect(isMultipleResult._unsafeUnwrap().toBoolean()).toBe(true);
    });
  });

  describe('computed field', () => {
    it('is always computed', () => {
      const fieldIdResult = createFieldId('6');
      const innerFieldIdResult = createFieldId('7');
      const linkFieldIdResult = createFieldId('8');
      const foreignTableIdResult = createTableId('9');
      const lookupFieldIdResult = createFieldId('0');
      const fieldNameResult = FieldName.create('Lookup');
      const innerFieldNameResult = FieldName.create('Inner');

      const innerFieldResult = SingleLineTextField.create({
        id: innerFieldIdResult._unsafeUnwrap(),
        name: innerFieldNameResult._unsafeUnwrap(),
      });

      const lookupOptionsResult = LookupOptions.create({
        linkFieldId: linkFieldIdResult._unsafeUnwrap().toString(),
        foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
        lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      });

      const lookupFieldResult = LookupField.create({
        id: fieldIdResult._unsafeUnwrap(),
        name: fieldNameResult._unsafeUnwrap(),
        innerField: innerFieldResult._unsafeUnwrap(),
        lookupOptions: lookupOptionsResult._unsafeUnwrap(),
      });

      expect(lookupFieldResult._unsafeUnwrap().computed().toBoolean()).toBe(true);
    });
  });

  describe('foreign table validation', () => {
    it('validates lookup field against host and foreign tables', () => {
      const baseIdResult = createBaseId('a');
      const hostTableIdResult = createTableId('b');
      const foreignTableIdResult = createTableId('c');
      const hostTableNameResult = TableName.create('Host');
      const foreignTableNameResult = TableName.create('Foreign');
      const hostPrimaryIdResult = createFieldId('d');
      const foreignPrimaryIdResult = createFieldId('e');
      const linkFieldIdResult = createFieldId('f');
      const lookupFieldIdResult = createFieldId('g');
      const lookupInnerFieldIdResult = createFieldId('h');

      const baseId = baseIdResult._unsafeUnwrap();
      const hostTableId = hostTableIdResult._unsafeUnwrap();
      const foreignTableId = foreignTableIdResult._unsafeUnwrap();
      const foreignPrimaryId = foreignPrimaryIdResult._unsafeUnwrap();

      // Build foreign table with a primary field
      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(foreignTableNameResult._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withId(foreignPrimaryId)
        .withName(FieldName.create('Foreign Name')._unsafeUnwrap())
        .primary()
        .done();
      foreignBuilder.view().defaultGrid().done();
      const foreignTableResult = foreignBuilder.build();
      const foreignTable = foreignTableResult._unsafeUnwrap();

      // Create link field config
      const linkConfigResult = LinkFieldConfig.create({
        relationship: LinkRelationship.manyMany().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignPrimaryId.toString(),
        fkHostTableName: 'junction',
        selfKeyName: '__id',
        foreignKeyName: '__fk',
      });

      // Build host table with link field
      const hostBuilder = Table.builder()
        .withId(hostTableId)
        .withBaseId(baseId)
        .withName(hostTableNameResult._unsafeUnwrap());
      hostBuilder
        .field()
        .singleLineText()
        .withId(hostPrimaryIdResult._unsafeUnwrap())
        .withName(FieldName.create('Host Name')._unsafeUnwrap())
        .primary()
        .done();
      hostBuilder
        .field()
        .link()
        .withId(linkFieldIdResult._unsafeUnwrap())
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfigResult._unsafeUnwrap())
        .done();
      hostBuilder.view().defaultGrid().done();
      const hostTableResult = hostBuilder.build();
      const hostTable = hostTableResult._unsafeUnwrap();

      // Create lookup field
      const innerFieldResult = SingleLineTextField.create({
        id: lookupInnerFieldIdResult._unsafeUnwrap(),
        name: FieldName.create('Inner')._unsafeUnwrap(),
      });

      const lookupOptionsResult = LookupOptions.create({
        linkFieldId: linkFieldIdResult._unsafeUnwrap().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignPrimaryId.toString(),
      });

      const lookupFieldResult = LookupField.create({
        id: lookupFieldIdResult._unsafeUnwrap(),
        name: FieldName.create('Lookup')._unsafeUnwrap(),
        innerField: innerFieldResult._unsafeUnwrap(),
        lookupOptions: lookupOptionsResult._unsafeUnwrap(),
      });

      const validationResult = lookupFieldResult._unsafeUnwrap().validateForeignTables({
        hostTable,
        foreignTables: [foreignTable],
      });

      expect(validationResult.isOk()).toBe(true);
    });

    it('rejects when link field is not found in host table', () => {
      const baseIdResult = createBaseId('i');
      const hostTableIdResult = createTableId('j');
      const foreignTableIdResult = createTableId('k');
      const hostTableNameResult = TableName.create('Host');
      const hostPrimaryIdResult = createFieldId('l');
      const linkFieldIdResult = createFieldId('m'); // not added to host table
      const lookupFieldIdResult = createFieldId('n');
      const lookupInnerFieldIdResult = createFieldId('o');

      const baseId = baseIdResult._unsafeUnwrap();
      const hostTableId = hostTableIdResult._unsafeUnwrap();
      const foreignTableId = foreignTableIdResult._unsafeUnwrap();

      // Build host table WITHOUT link field
      const hostBuilder = Table.builder()
        .withId(hostTableId)
        .withBaseId(baseId)
        .withName(hostTableNameResult._unsafeUnwrap());
      hostBuilder
        .field()
        .singleLineText()
        .withId(hostPrimaryIdResult._unsafeUnwrap())
        .withName(FieldName.create('Host Name')._unsafeUnwrap())
        .primary()
        .done();
      hostBuilder.view().defaultGrid().done();
      const hostTableResult = hostBuilder.build();
      const hostTable = hostTableResult._unsafeUnwrap();

      // Create lookup field referencing a non-existent link field
      const innerFieldResult = SingleLineTextField.create({
        id: lookupInnerFieldIdResult._unsafeUnwrap(),
        name: FieldName.create('Inner')._unsafeUnwrap(),
      });

      const lookupOptionsResult = LookupOptions.create({
        linkFieldId: linkFieldIdResult._unsafeUnwrap().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: 'fld' + 'p'.repeat(16),
      });

      const lookupFieldResult = LookupField.create({
        id: lookupFieldIdResult._unsafeUnwrap(),
        name: FieldName.create('Lookup')._unsafeUnwrap(),
        innerField: innerFieldResult._unsafeUnwrap(),
        lookupOptions: lookupOptionsResult._unsafeUnwrap(),
      });

      const validationResult = lookupFieldResult._unsafeUnwrap().validateForeignTables({
        hostTable,
        foreignTables: [],
      });

      expect(validationResult.isErr()).toBe(true);
    });
  });

  describe('lookup options dto', () => {
    it('returns the lookup options as DTO', () => {
      const fieldIdResult = createFieldId('p');
      const innerFieldIdResult = createFieldId('q');
      const linkFieldIdResult = createFieldId('r');
      const foreignTableIdResult = createTableId('s');
      const lookupFieldIdResult = createFieldId('t');
      const fieldNameResult = FieldName.create('Lookup');
      const innerFieldNameResult = FieldName.create('Inner');

      const innerFieldResult = SingleLineTextField.create({
        id: innerFieldIdResult._unsafeUnwrap(),
        name: innerFieldNameResult._unsafeUnwrap(),
      });

      const lookupOptionsResult = LookupOptions.create({
        linkFieldId: linkFieldIdResult._unsafeUnwrap().toString(),
        foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
        lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      });

      const lookupFieldResult = LookupField.create({
        id: fieldIdResult._unsafeUnwrap(),
        name: fieldNameResult._unsafeUnwrap(),
        innerField: innerFieldResult._unsafeUnwrap(),
        lookupOptions: lookupOptionsResult._unsafeUnwrap(),
      });

      const lookupField = lookupFieldResult._unsafeUnwrap();
      const dto = lookupField.lookupOptionsDto();

      expect(dto.linkFieldId).toBe(linkFieldIdResult._unsafeUnwrap().toString());
      expect(dto.foreignTableId).toBe(foreignTableIdResult._unsafeUnwrap().toString());
      expect(dto.lookupFieldId).toBe(lookupFieldIdResult._unsafeUnwrap().toString());
    });
  });
});
