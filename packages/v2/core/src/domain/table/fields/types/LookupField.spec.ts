import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import type { DomainError } from '../../../shared/DomainError';
import { DbFieldName } from '../DbFieldName';
import { Table } from '../../Table';
import { TableId } from '../../TableId';
import { TableName } from '../../TableName';
import { TableUpdateFieldHasErrorSpec } from '../../specs/TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldTypeSpec } from '../../specs/TableUpdateFieldTypeSpec';
import { UpdateLookupOptionsSpec } from '../../specs/field-updates/UpdateLookupOptionsSpec';
import { UpdateSingleSelectOptionsSpec } from '../../specs/field-updates/UpdateSingleSelectOptionsSpec';
import { UpdateLinkRelationshipSpec } from '../../specs/field-updates/UpdateLinkRelationshipSpec';
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

    it('keeps v2 default multiplicity for manyOne lookup without legacy derivation', () => {
      const baseId = createBaseId('r')._unsafeUnwrap();
      const hostTableId = createTableId('s')._unsafeUnwrap();
      const foreignTableId = createTableId('t')._unsafeUnwrap();
      const hostPrimaryId = createFieldId('u')._unsafeUnwrap();
      const foreignPrimaryId = createFieldId('v')._unsafeUnwrap();
      const linkFieldId = createFieldId('w')._unsafeUnwrap();
      const lookupFieldId = createFieldId('x')._unsafeUnwrap();

      const foreignTable = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Foreign')._unsafeUnwrap())
        .field()
        .singleLineText()
        .withId(foreignPrimaryId)
        .withName(FieldName.create('Foreign Name')._unsafeUnwrap())
        .primary()
        .done()
        .view()
        .defaultGrid()
        .done()
        .build()
        ._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: LinkRelationship.manyOne().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignPrimaryId.toString(),
      })._unsafeUnwrap();

      const hostBuilder = Table.builder()
        .withId(hostTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Host')._unsafeUnwrap());
      hostBuilder
        .field()
        .singleLineText()
        .withId(hostPrimaryId)
        .withName(FieldName.create('Host Name')._unsafeUnwrap())
        .primary()
        .done();
      hostBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      hostBuilder.view().defaultGrid().done();
      const hostTable = hostBuilder.build()._unsafeUnwrap();

      const lookupField = LookupField.createPending({
        id: lookupFieldId,
        name: FieldName.create('Lookup')._unsafeUnwrap(),
        lookupOptions: LookupOptions.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignPrimaryId.toString(),
        })._unsafeUnwrap(),
      })._unsafeUnwrap();

      expect(lookupField.isMultipleCellValue()._unsafeUnwrap().isMultiple()).toBe(true);

      const validationResult = lookupField.validateForeignTables({
        hostTable,
        foreignTables: [foreignTable],
      });
      expect(validationResult.isOk()).toBe(true);
      expect(lookupField.isMultipleCellValue()._unsafeUnwrap().isMultiple()).toBe(true);
    });

    it('derives single multiplicity for manyOne lookup to single-value target in legacy mode', () => {
      const baseId = createBaseId('g')._unsafeUnwrap();
      const hostTableId = createTableId('h')._unsafeUnwrap();
      const foreignTableId = createTableId('i')._unsafeUnwrap();
      const hostPrimaryId = createFieldId('j')._unsafeUnwrap();
      const foreignPrimaryId = createFieldId('k')._unsafeUnwrap();
      const linkFieldId = createFieldId('l')._unsafeUnwrap();
      const lookupFieldId = createFieldId('m')._unsafeUnwrap();

      const foreignTable = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Foreign Legacy')._unsafeUnwrap())
        .field()
        .singleLineText()
        .withId(foreignPrimaryId)
        .withName(FieldName.create('Foreign Name')._unsafeUnwrap())
        .primary()
        .done()
        .view()
        .defaultGrid()
        .done()
        .build()
        ._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: LinkRelationship.manyOne().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignPrimaryId.toString(),
      })._unsafeUnwrap();

      const hostBuilder = Table.builder()
        .withId(hostTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Host Legacy')._unsafeUnwrap());
      hostBuilder
        .field()
        .singleLineText()
        .withId(hostPrimaryId)
        .withName(FieldName.create('Host Name')._unsafeUnwrap())
        .primary()
        .done();
      hostBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      hostBuilder.view().defaultGrid().done();
      const hostTable = hostBuilder.build()._unsafeUnwrap();

      const lookupField = LookupField.createPending({
        id: lookupFieldId,
        name: FieldName.create('Lookup Legacy')._unsafeUnwrap(),
        lookupOptions: LookupOptions.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignPrimaryId.toString(),
        })._unsafeUnwrap(),
        legacyMultiplicityDerivation: true,
      })._unsafeUnwrap();

      const validationResult = lookupField.validateForeignTables({
        hostTable,
        foreignTables: [foreignTable],
      });
      expect(validationResult.isOk()).toBe(true);
      expect(lookupField.isMultipleCellValue()._unsafeUnwrap().isMultiple()).toBe(false);
    });

    it('derives multiple multiplicity when lookup target is multi-value on manyOne link in legacy mode', () => {
      const baseId = createBaseId('y')._unsafeUnwrap();
      const hostTableId = createTableId('z')._unsafeUnwrap();
      const foreignTableId = createTableId('a')._unsafeUnwrap();
      const hostPrimaryId = createFieldId('b')._unsafeUnwrap();
      const foreignPrimaryId = createFieldId('c')._unsafeUnwrap();
      const foreignMultiFieldId = createFieldId('d')._unsafeUnwrap();
      const linkFieldId = createFieldId('e')._unsafeUnwrap();
      const lookupFieldId = createFieldId('f')._unsafeUnwrap();
      const option = SelectOption.create({ name: 'Done', color: 'blue' })._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Foreign')._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withId(foreignPrimaryId)
        .withName(FieldName.create('Foreign Name')._unsafeUnwrap())
        .primary()
        .done();
      foreignBuilder
        .field()
        .multipleSelect()
        .withId(foreignMultiFieldId)
        .withName(FieldName.create('Tags')._unsafeUnwrap())
        .withOptions([option])
        .done();
      foreignBuilder.view().defaultGrid().done();
      const foreignTable = foreignBuilder.build()._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: LinkRelationship.manyOne().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: foreignPrimaryId.toString(),
      })._unsafeUnwrap();

      const hostBuilder = Table.builder()
        .withId(hostTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Host')._unsafeUnwrap());
      hostBuilder
        .field()
        .singleLineText()
        .withId(hostPrimaryId)
        .withName(FieldName.create('Host Name')._unsafeUnwrap())
        .primary()
        .done();
      hostBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();
      hostBuilder.view().defaultGrid().done();
      const hostTable = hostBuilder.build()._unsafeUnwrap();

      const lookupField = LookupField.createPending({
        id: lookupFieldId,
        name: FieldName.create('Lookup Tags')._unsafeUnwrap(),
        lookupOptions: LookupOptions.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignMultiFieldId.toString(),
        })._unsafeUnwrap(),
        legacyMultiplicityDerivation: true,
      })._unsafeUnwrap();

      const validationResult = lookupField.validateForeignTables({
        hostTable,
        foreignTables: [foreignTable],
      });
      expect(validationResult.isOk()).toBe(true);
      expect(lookupField.isMultipleCellValue()._unsafeUnwrap().isMultiple()).toBe(true);
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

  describe('onDependencyUpdated', () => {
    it('sets hasError when link dependency is type-converted', () => {
      const linkFieldId = createFieldId('u')._unsafeUnwrap();
      const foreignTableId = createTableId('v')._unsafeUnwrap();
      const lookupTargetId = createFieldId('w')._unsafeUnwrap();

      const lookupField = LookupField.create({
        id: createFieldId('x')._unsafeUnwrap(),
        name: FieldName.create('Lookup')._unsafeUnwrap(),
        innerField: SingleLineTextField.create({
          id: createFieldId('y')._unsafeUnwrap(),
          name: FieldName.create('Title')._unsafeUnwrap(),
        })._unsafeUnwrap(),
        lookupOptions: LookupOptions.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupTargetId.toString(),
        })._unsafeUnwrap(),
      })._unsafeUnwrap();

      const oldLinkField = LinkField.create({
        id: linkFieldId,
        name: FieldName.create('Link')._unsafeUnwrap(),
        config: LinkFieldConfig.create({
          relationship: LinkRelationship.manyOne().toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupTargetId.toString(),
        })._unsafeUnwrap(),
      })._unsafeUnwrap();

      const convertedField = SingleLineTextField.create({
        id: linkFieldId,
        name: FieldName.create('Link Text')._unsafeUnwrap(),
      })._unsafeUnwrap();
      const conversionSpec = TableUpdateFieldTypeSpec.create(oldLinkField, convertedField);

      const result = lookupField.onDependencyUpdated(oldLinkField, [conversionSpec], {} as never);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(TableUpdateFieldHasErrorSpec);
    });

    it('updates lookup filter values when referenced select option names change', () => {
      const linkFieldId = createFieldId('z')._unsafeUnwrap();
      const foreignTableId = createTableId('a')._unsafeUnwrap();
      const lookupTargetId = createFieldId('b')._unsafeUnwrap();
      const statusFieldId = createFieldId('c')._unsafeUnwrap();

      const lookupField = LookupField.create({
        id: createFieldId('d')._unsafeUnwrap(),
        name: FieldName.create('Lookup')._unsafeUnwrap(),
        innerField: SingleLineTextField.create({
          id: createFieldId('e')._unsafeUnwrap(),
          name: FieldName.create('Title')._unsafeUnwrap(),
        })._unsafeUnwrap(),
        lookupOptions: LookupOptions.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupTargetId.toString(),
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: statusFieldId.toString(), operator: 'is', value: 'Active' }],
          },
        })._unsafeUnwrap(),
      })._unsafeUnwrap();

      const statusField = SingleSelectField.create({
        id: statusFieldId,
        name: FieldName.create('Status')._unsafeUnwrap(),
        options: [
          SelectOption.create({ id: 'cho_active', name: 'Active', color: 'green' })._unsafeUnwrap(),
          SelectOption.create({ id: 'cho_closed', name: 'Closed', color: 'red' })._unsafeUnwrap(),
        ],
      })._unsafeUnwrap();

      const optionsSpec = UpdateSingleSelectOptionsSpec.create(
        statusFieldId,
        DbFieldName.rehydrate('status')._unsafeUnwrap(),
        statusField.selectOptions(),
        [
          SelectOption.create({
            id: 'cho_active',
            name: 'Active Plus',
            color: 'green',
          })._unsafeUnwrap(),
          SelectOption.create({ id: 'cho_closed', name: 'Closed', color: 'red' })._unsafeUnwrap(),
        ]
      );

      const result = lookupField.onDependencyUpdated(statusField, [optionsSpec], {} as never);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(UpdateLookupOptionsSpec);

      const updateSpec = result._unsafeUnwrap() as UpdateLookupOptionsSpec;
      const nextFilter = updateSpec.nextOptions().condition()?.toDto().filter as {
        filterSet: Array<{ value?: unknown }>;
      };
      expect(nextFilter.filterSet[0]?.value).toBe('Active Plus');
    });

    it('emits TableUpdateFieldTypeSpec when lookup target select options are changed', () => {
      const linkFieldId = createFieldId('l')._unsafeUnwrap();
      const foreignTableId = createTableId('m')._unsafeUnwrap();
      const lookupTargetId = createFieldId('n')._unsafeUnwrap();

      const previousInnerField = SingleSelectField.create({
        id: lookupTargetId,
        name: FieldName.create('Status')._unsafeUnwrap(),
        options: [SelectOption.create({ id: 'cho_x', name: 'x', color: 'cyan' })._unsafeUnwrap()],
      })._unsafeUnwrap();

      const lookupField = LookupField.create({
        id: createFieldId('o')._unsafeUnwrap(),
        name: FieldName.create('Lookup Status')._unsafeUnwrap(),
        innerField: previousInnerField,
        lookupOptions: LookupOptions.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupTargetId.toString(),
        })._unsafeUnwrap(),
      })._unsafeUnwrap();

      const updatedInnerField = SingleSelectField.create({
        id: lookupTargetId,
        name: FieldName.create('Status')._unsafeUnwrap(),
        options: [
          SelectOption.create({ id: 'cho_x', name: 'x', color: 'cyan' })._unsafeUnwrap(),
          SelectOption.create({ id: 'cho_y', name: 'y', color: 'blue' })._unsafeUnwrap(),
        ],
      })._unsafeUnwrap();

      const optionsSpec = UpdateSingleSelectOptionsSpec.create(
        lookupTargetId,
        DbFieldName.rehydrate('status')._unsafeUnwrap(),
        previousInnerField.selectOptions(),
        updatedInnerField.selectOptions()
      );

      const result = lookupField.onDependencyUpdated(updatedInnerField, [optionsSpec], {
        table: {} as Table,
        foreignTables: [],
      });

      expect(result.isOk()).toBe(true);
      const spec = result._unsafeUnwrap();
      expect(spec).toBeInstanceOf(TableUpdateFieldTypeSpec);

      const typeSpec = spec as TableUpdateFieldTypeSpec;
      const nextLookup = typeSpec.newField() as LookupField;
      const nextInner = nextLookup.innerField()._unsafeUnwrap() as SingleSelectField;
      expect(nextInner.selectOptions()).toHaveLength(2);
      expect(nextInner.selectOptions()[1]?.name().toString()).toBe('y');
    });

    it('sets hasError when value-referenced field in filter is type-converted', () => {
      const linkFieldId = createFieldId('f')._unsafeUnwrap();
      const foreignTableId = createTableId('g')._unsafeUnwrap();
      const lookupTargetId = createFieldId('h')._unsafeUnwrap();
      const foreignStatusFieldId = createFieldId('i')._unsafeUnwrap();
      const hostStatusFieldId = createFieldId('j')._unsafeUnwrap();

      const lookupField = LookupField.create({
        id: createFieldId('k')._unsafeUnwrap(),
        name: FieldName.create('Lookup')._unsafeUnwrap(),
        innerField: SingleLineTextField.create({
          id: createFieldId('l')._unsafeUnwrap(),
          name: FieldName.create('Title')._unsafeUnwrap(),
        })._unsafeUnwrap(),
        lookupOptions: LookupOptions.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupTargetId.toString(),
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: foreignStatusFieldId.toString(),
                operator: 'is',
                value: { type: 'field', fieldId: hostStatusFieldId.toString() },
              },
            ],
          },
        })._unsafeUnwrap(),
      })._unsafeUnwrap();

      const updatedField = SingleSelectField.create({
        id: hostStatusFieldId,
        name: FieldName.create('Host Status')._unsafeUnwrap(),
        options: [
          SelectOption.create({ id: 'cho_a', name: 'Active', color: 'green' })._unsafeUnwrap(),
        ],
      })._unsafeUnwrap();
      const convertedField = SingleLineTextField.create({
        id: hostStatusFieldId,
        name: FieldName.create('Host Status')._unsafeUnwrap(),
      })._unsafeUnwrap();
      const conversionSpec = TableUpdateFieldTypeSpec.create(updatedField, convertedField);

      const result = lookupField.onDependencyUpdated(updatedField, [conversionSpec], {} as never);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(TableUpdateFieldHasErrorSpec);
    });

    it('emits TableUpdateFieldTypeSpec when link relationship changes multiplicity', () => {
      const linkFieldId = createFieldId('f')._unsafeUnwrap();
      const foreignTableId = createTableId('g')._unsafeUnwrap();
      const lookupTargetId = createFieldId('h')._unsafeUnwrap();

      const lookupField = LookupField.create({
        id: createFieldId('k')._unsafeUnwrap(),
        name: FieldName.create('Lookup')._unsafeUnwrap(),
        innerField: SingleLineTextField.create({
          id: createFieldId('l')._unsafeUnwrap(),
          name: FieldName.create('Title')._unsafeUnwrap(),
        })._unsafeUnwrap(),
        lookupOptions: LookupOptions.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupTargetId.toString(),
        })._unsafeUnwrap(),
        isMultipleCellValue: true, // ManyMany → multiple
      })._unsafeUnwrap();

      // Convert link field from ManyMany to ManyOne
      const manyManyConfig = LinkFieldConfig.create({
        relationship: LinkRelationship.manyMany().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupTargetId.toString(),
        fkHostTableName: 'junction',
        selfKeyName: '__id',
        foreignKeyName: '__fk',
      })._unsafeUnwrap();
      const manyOneConfig = LinkFieldConfig.create({
        relationship: LinkRelationship.manyOne().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupTargetId.toString(),
      })._unsafeUnwrap();

      const updatedLinkField = LinkField.create({
        id: linkFieldId,
        name: FieldName.create('Link')._unsafeUnwrap(),
        config: manyOneConfig,
      })._unsafeUnwrap();

      const dbFieldName = DbFieldName.rehydrate('link_col')._unsafeUnwrap();
      const relationshipSpec = UpdateLinkRelationshipSpec.create({
        fieldId: linkFieldId,
        dbFieldName,
        previousConfig: manyManyConfig,
        nextConfig: manyOneConfig,
      });

      const result = lookupField.onDependencyUpdated(
        updatedLinkField,
        [relationshipSpec],
        {} as never
      );
      expect(result.isOk()).toBe(true);
      const spec = result._unsafeUnwrap();
      expect(spec).toBeInstanceOf(TableUpdateFieldTypeSpec);

      // The new lookup field should have isMultipleCellValue = false (ManyOne)
      const typeSpec = spec as TableUpdateFieldTypeSpec;
      const newField = typeSpec.newField() as LookupField;
      const isMultiple = newField.isMultipleCellValue()._unsafeUnwrap();
      expect(isMultiple.isMultiple()).toBe(false);
    });

    it('does not emit specs when link relationship changes but multiplicity stays same', () => {
      const linkFieldId = createFieldId('f')._unsafeUnwrap();
      const foreignTableId = createTableId('g')._unsafeUnwrap();
      const lookupTargetId = createFieldId('h')._unsafeUnwrap();

      // Lookup with isMultipleCellValue = false (ManyOne)
      const lookupField = LookupField.create({
        id: createFieldId('k')._unsafeUnwrap(),
        name: FieldName.create('Lookup')._unsafeUnwrap(),
        innerField: SingleLineTextField.create({
          id: createFieldId('l')._unsafeUnwrap(),
          name: FieldName.create('Title')._unsafeUnwrap(),
        })._unsafeUnwrap(),
        lookupOptions: LookupOptions.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupTargetId.toString(),
        })._unsafeUnwrap(),
        isMultipleCellValue: false, // ManyOne → single
      })._unsafeUnwrap();

      // Convert link field from ManyOne to OneOne (both single)
      const manyOneConfig = LinkFieldConfig.create({
        relationship: LinkRelationship.manyOne().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupTargetId.toString(),
      })._unsafeUnwrap();
      const oneOneConfig = LinkFieldConfig.create({
        relationship: LinkRelationship.oneOne().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupTargetId.toString(),
      })._unsafeUnwrap();

      const updatedLinkField = LinkField.create({
        id: linkFieldId,
        name: FieldName.create('Link')._unsafeUnwrap(),
        config: oneOneConfig,
      })._unsafeUnwrap();

      const dbFieldName = DbFieldName.rehydrate('link_col')._unsafeUnwrap();
      const relationshipSpec = UpdateLinkRelationshipSpec.create({
        fieldId: linkFieldId,
        dbFieldName,
        previousConfig: manyOneConfig,
        nextConfig: oneOneConfig,
      });

      const result = lookupField.onDependencyUpdated(
        updatedLinkField,
        [relationshipSpec],
        {} as never
      );
      expect(result.isOk()).toBe(true);
      // Both ManyOne and OneOne are single-value, no multiplicity change
      expect(result._unsafeUnwrap()).toBeUndefined();
    });
  });

  describe('UpdateLookupOptionsSpec preserves isMultipleCellValue', () => {
    it('preserves isMultipleCellValue=false from the original field', () => {
      const baseId = createBaseId('a')._unsafeUnwrap();
      const tableId = createTableId('b')._unsafeUnwrap();
      const primaryFieldId = createFieldId('c')._unsafeUnwrap();
      const linkFieldId = createFieldId('d')._unsafeUnwrap();
      const lookupFieldId = createFieldId('e')._unsafeUnwrap();
      const foreignTableId = createTableId('f')._unsafeUnwrap();
      const lookupTargetFieldId1 = createFieldId('g')._unsafeUnwrap();
      const lookupTargetFieldId2 = createFieldId('h')._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: LinkRelationship.manyOne().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupTargetFieldId1.toString(),
      })._unsafeUnwrap();

      const builder = Table.builder()
        .withId(tableId)
        .withBaseId(baseId)
        .withName(TableName.create('Test')._unsafeUnwrap());

      builder
        .field()
        .singleLineText()
        .withId(primaryFieldId)
        .withName(FieldName.create('Primary')._unsafeUnwrap())
        .primary()
        .done();

      builder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(linkConfig)
        .done();

      builder
        .field()
        .lookup()
        .withId(lookupFieldId)
        .withName(FieldName.create('Lookup')._unsafeUnwrap())
        .withInnerField(
          SingleLineTextField.create({
            id: createFieldId('i')._unsafeUnwrap(),
            name: FieldName.create('Inner')._unsafeUnwrap(),
          })._unsafeUnwrap()
        )
        .withLookupOptions(
          LookupOptions.create({
            linkFieldId: linkFieldId.toString(),
            foreignTableId: foreignTableId.toString(),
            lookupFieldId: lookupTargetFieldId1.toString(),
          })._unsafeUnwrap()
        )
        .withIsMultipleCellValue(false)
        .done();

      builder.view().defaultGrid().done();

      const table = builder.build()._unsafeUnwrap();

      // Change lookupFieldId
      const prevOptions = LookupOptions.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupTargetFieldId1.toString(),
      })._unsafeUnwrap();
      const nextOptions = LookupOptions.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupTargetFieldId2.toString(),
      })._unsafeUnwrap();

      const spec = UpdateLookupOptionsSpec.create(lookupFieldId, prevOptions, nextOptions);
      const result = spec.mutate(table);
      expect(result.isOk()).toBe(true);

      const updatedTable = result._unsafeUnwrap();
      const updatedField = updatedTable
        .getField((f) => f.id().equals(lookupFieldId))
        ._unsafeUnwrap() as LookupField;

      // isMultipleCellValue should be preserved as false
      const isMultiple = updatedField.isMultipleCellValue()._unsafeUnwrap();
      expect(isMultiple.isMultiple()).toBe(false);
    });
  });
});
