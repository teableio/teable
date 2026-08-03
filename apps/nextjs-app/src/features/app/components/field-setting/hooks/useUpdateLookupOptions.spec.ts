import { CellValueType, FieldType, Relationship } from '@teable/core';
import type { IFieldInstance, LinkField } from '@teable/sdk/model';
import { renderHook, act } from '@testing-library/react';
import type { IFieldEditorRo } from '../type';
import { useUpdateLookupOptions } from './useUpdateLookupOptions';

describe('useUpdateLookupOptions', () => {
  it('should update lookup options', () => {
    const field = {
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'foreignTableId',
      },
    } as IFieldEditorRo;
    const setField = vi.fn();

    const { result } = renderHook(() => useUpdateLookupOptions(field, setField));

    act(() => {
      result.current({
        linkFieldId: 'linkFieldId',
      });
    });

    expect(setField).toHaveBeenCalledWith({
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'foreignTableId',
        linkFieldId: 'linkFieldId',
      },
    });
  });

  it('should update lookup options with field type change', () => {
    const field = {
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'foreignTableId',
        linkFieldId: 'linkFieldId',
      },
    } as IFieldEditorRo;
    const setField = vi.fn();

    const { result } = renderHook(() => useUpdateLookupOptions(field, setField));

    act(() => {
      result.current(
        {
          lookupFieldId: 'lookupFieldId',
        },
        {
          type: FieldType.Link,
          cellValueType: CellValueType.String,
        } as LinkField,
        {
          type: FieldType.Number,
          cellValueType: CellValueType.Number,
        } as IFieldInstance
      );
    });

    expect(setField).toHaveBeenCalledWith({
      type: FieldType.Number,
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'foreignTableId',
        linkFieldId: 'linkFieldId',
        lookupFieldId: 'lookupFieldId',
      },
      cellValueType: CellValueType.Number,
    });
  });

  it('should update lookup options with isMultipleCellValue lookupField', () => {
    const field = {
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'foreignTableId',
        linkFieldId: 'linkFieldId',
      },
    } as IFieldEditorRo;
    const setField = vi.fn();

    const { result } = renderHook(() => useUpdateLookupOptions(field, setField));

    act(() => {
      result.current(
        {
          lookupFieldId: 'lookupFieldId',
        },
        {
          type: FieldType.Link,
          cellValueType: CellValueType.String,
        } as LinkField,
        {
          isLookup: true,
          type: FieldType.Number,
          cellValueType: CellValueType.Number,
          isMultipleCellValue: true,
        } as IFieldInstance
      );
    });

    expect(setField).toHaveBeenCalledWith({
      type: FieldType.Number,
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'foreignTableId',
        linkFieldId: 'linkFieldId',
        lookupFieldId: 'lookupFieldId',
      },
      cellValueType: CellValueType.Number,
      isMultipleCellValue: true,
    });
  });

  it('should update lookup options with isMultipleCellValue linkField', () => {
    const field = {
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'foreignTableId',
        linkFieldId: 'linkFieldId',
      },
    } as IFieldEditorRo;
    const setField = vi.fn();

    const { result } = renderHook(() => useUpdateLookupOptions(field, setField));

    act(() => {
      result.current(
        {
          lookupFieldId: 'lookupFieldId',
        },
        {
          type: FieldType.Link,
          cellValueType: CellValueType.String,
          isMultipleCellValue: true,
        } as LinkField,
        {
          type: FieldType.Number,
          cellValueType: CellValueType.Number,
        } as IFieldInstance
      );
    });

    expect(setField).toHaveBeenCalledWith({
      type: FieldType.Number,
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'foreignTableId',
        linkFieldId: 'linkFieldId',
        lookupFieldId: 'lookupFieldId',
      },
      cellValueType: CellValueType.Number,
      isMultipleCellValue: true,
    });
  });

  it('keeps rollup options when linking to a lookup field', () => {
    const field = {
      type: FieldType.Rollup,
      options: {
        expression: 'sum({values})',
        timeZone: 'UTC',
      },
      lookupOptions: {
        foreignTableId: 'foreignTableId',
        linkFieldId: 'linkFieldId',
      },
    } as IFieldEditorRo;
    const setField = vi.fn();

    const { result } = renderHook(() => useUpdateLookupOptions(field, setField));

    act(() => {
      result.current(
        {
          lookupFieldId: 'lookupFieldId',
        },
        {
          type: FieldType.Link,
          isMultipleCellValue: true,
        } as LinkField,
        {
          id: 'lookupFieldId',
          type: FieldType.Link,
          cellValueType: CellValueType.String,
          isMultipleCellValue: true,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: 'foreignTableId',
            lookupFieldId: 'displayFieldId',
            fkHostTableName: 'host_table',
            selfKeyName: 'selfKey',
            foreignKeyName: 'foreignKey',
          },
        } as unknown as IFieldInstance
      );
    });

    expect(setField).toHaveBeenCalledWith({
      type: FieldType.Rollup,
      options: field.options,
      lookupOptions: {
        foreignTableId: 'foreignTableId',
        linkFieldId: 'linkFieldId',
        lookupFieldId: 'lookupFieldId',
      },
      cellValueType: CellValueType.String,
      isMultipleCellValue: true,
    });
  });
});
