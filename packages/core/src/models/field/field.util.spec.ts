/* eslint-disable sonarjs/no-duplicate-string */
import { FieldType, DbFieldType, CellValueType, OpName } from '../..';
import type { ISetFieldPropertyOpContext } from '../../op-builder/field/set-field-property';
import type { IFieldVo } from './field.schema';
import { applyFieldPropertyOps } from './field.util';

describe('applyFieldPropertyOps', () => {
  const mockField: IFieldVo = {
    id: 'fld123',
    name: 'Test Field',
    type: FieldType.SingleLineText,
    dbFieldName: 'test_field',
    dbFieldType: DbFieldType.Text,
    cellValueType: CellValueType.String,
    options: {},
    description: 'Original description',
    notNull: false,
    unique: false,
  };

  it('should apply single field property operation', () => {
    const ops: ISetFieldPropertyOpContext[] = [
      {
        name: OpName.SetFieldProperty,
        key: 'name',
        newValue: 'Updated Field Name',
        oldValue: 'Test Field',
      },
    ];

    const result = applyFieldPropertyOps(mockField, ops);

    expect(result.name).toBe('Updated Field Name');
    expect(result.id).toBe(mockField.id); // Other properties should remain unchanged
    expect(result.type).toBe(mockField.type);

    // Original field should remain unchanged (immutability test)
    expect(mockField.name).toBe('Test Field');
  });

  it('should apply multiple field property operations', () => {
    const ops: ISetFieldPropertyOpContext[] = [
      {
        name: OpName.SetFieldProperty,
        key: 'name',
        newValue: 'Updated Name',
        oldValue: 'Test Field',
      },
      {
        name: OpName.SetFieldProperty,
        key: 'description',
        newValue: 'Updated description',
        oldValue: 'Original description',
      },
      {
        name: OpName.SetFieldProperty,
        key: 'notNull',
        newValue: true,
        oldValue: false,
      },
    ];

    const result = applyFieldPropertyOps(mockField, ops);

    expect(result.name).toBe('Updated Name');
    expect(result.description).toBe('Updated description');
    expect(result.notNull).toBe(true);

    // Original field should remain unchanged
    expect(mockField.name).toBe('Test Field');
    expect(mockField.description).toBe('Original description');
    expect(mockField.notNull).toBe(false);
  });

  it('should handle empty operations array', () => {
    const ops: ISetFieldPropertyOpContext[] = [];
    const result = applyFieldPropertyOps(mockField, ops);

    expect(result).toEqual(mockField);
    expect(result).not.toBe(mockField); // Should be a different object (deep copy)
  });

  it('should handle options property updates', () => {
    const ops: ISetFieldPropertyOpContext[] = [
      {
        name: OpName.SetFieldProperty,
        key: 'options',
        newValue: { maxLength: 100 },
        oldValue: {},
      },
    ];

    const result = applyFieldPropertyOps(mockField, ops);

    expect(result.options).toEqual({ maxLength: 100 });
    expect(mockField.options).toEqual({}); // Original should remain unchanged
  });

  it('should handle null/undefined values', () => {
    const ops: ISetFieldPropertyOpContext[] = [
      {
        name: OpName.SetFieldProperty,
        key: 'description',
        newValue: undefined,
        oldValue: 'Original description',
      },
    ];

    const result = applyFieldPropertyOps(mockField, ops);

    expect(result.description).toBeUndefined();
    expect(mockField.description).toBe('Original description');
  });
});
