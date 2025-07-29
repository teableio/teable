import { plainToInstance } from 'class-transformer';
import { FieldType, CellValueType, DbFieldType } from './constant';
import { CheckboxFieldCore } from './derivate/checkbox.field';
import { NumberFieldCore } from './derivate/number.field';
import { SingleLineTextFieldCore } from './derivate/single-line-text.field';
import { FieldTypeNameVisitor, FieldCountVisitor } from './field-visitor.example';

describe('Field Visitor Pattern', () => {
  describe('FieldTypeNameVisitor', () => {
    it('should return correct field type names', () => {
      const visitor = new FieldTypeNameVisitor();

      // Test NumberFieldCore
      const numberField = plainToInstance(NumberFieldCore, {
        id: 'fld1',
        name: 'Number Field',
        type: FieldType.Number,
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        options: { formatting: { type: 'number', precision: 2 } },
      });

      expect(numberField.accept(visitor)).toBe('Number Field');

      // Test SingleLineTextFieldCore
      const textField = plainToInstance(SingleLineTextFieldCore, {
        id: 'fld2',
        name: 'Text Field',
        type: FieldType.SingleLineText,
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        options: {},
      });

      expect(textField.accept(visitor)).toBe('Single Line Text Field');

      // Test CheckboxFieldCore
      const checkboxField = plainToInstance(CheckboxFieldCore, {
        id: 'fld3',
        name: 'Checkbox Field',
        type: FieldType.Checkbox,
        dbFieldType: DbFieldType.Boolean,
        cellValueType: CellValueType.Boolean,
        options: {},
      });

      expect(checkboxField.accept(visitor)).toBe('Checkbox Field');
    });
  });

  describe('FieldCountVisitor', () => {
    it('should count fields correctly', () => {
      const visitor = new FieldCountVisitor();

      // Create test fields
      const numberField = plainToInstance(NumberFieldCore, {
        id: 'fld1',
        name: 'Number Field',
        type: FieldType.Number,
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        options: { formatting: { type: 'number', precision: 2 } },
      });

      const textField = plainToInstance(SingleLineTextFieldCore, {
        id: 'fld2',
        name: 'Text Field',
        type: FieldType.SingleLineText,
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        options: {},
      });

      const checkboxField = plainToInstance(CheckboxFieldCore, {
        id: 'fld3',
        name: 'Checkbox Field',
        type: FieldType.Checkbox,
        dbFieldType: DbFieldType.Boolean,
        cellValueType: CellValueType.Boolean,
        options: {},
      });

      // Visit fields and check count
      expect(numberField.accept(visitor)).toBe(1);
      expect(textField.accept(visitor)).toBe(2);
      expect(checkboxField.accept(visitor)).toBe(3);
      expect(visitor.getCount()).toBe(3);

      // Reset and test again
      visitor.resetCount();
      expect(visitor.getCount()).toBe(0);
      expect(numberField.accept(visitor)).toBe(1);
    });
  });

  describe('Type Safety', () => {
    it('should enforce type safety through visitor interface', () => {
      const visitor = new FieldTypeNameVisitor();

      const numberField = plainToInstance(NumberFieldCore, {
        id: 'fld1',
        name: 'Number Field',
        type: FieldType.Number,
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        options: { formatting: { type: 'number', precision: 2 } },
      });

      // This should compile and work correctly
      const result: string = numberField.accept(visitor);
      expect(typeof result).toBe('string');
      expect(result).toBe('Number Field');
    });
  });
});
