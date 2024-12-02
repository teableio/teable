import type {
  ISelectFieldOptions,
  ISingleSelectCellValue,
  IMultipleSelectCellValue,
  ISelectFieldChoice,
} from '@teable/core';
import { FieldType, ColorUtils } from '@teable/core';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import colors from 'tailwindcss/colors';
import { useTableId } from '../../../hooks';
import type { MultipleSelectField, SingleSelectField } from '../../../model';
import { Field } from '../../../model';
import { SelectEditorMain } from '../../editor';
import type { IEditorRef } from '../../editor/type';
import type { IEditorProps } from '../../grid/components';
import { useGridPopupPosition } from '../hooks';
import type { IWrapperEditorProps } from './type';

const GridSelectEditorBase: ForwardRefRenderFunction<
  IEditorRef<string | string[] | undefined>,
  IWrapperEditorProps & IEditorProps
> = (props, ref) => {
  const { field, record, rect, style, isEditing, setEditing } = props;
  const tableId = useTableId();
  const defaultFocusRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<IEditorRef<string | string[] | undefined>>(null);
  const {
    id: fieldId,
    type: fieldType,
    options,
    displayChoiceMap,
  } = field as SingleSelectField | MultipleSelectField;
  const isMultiple = fieldType === FieldType.MultipleSelect;
  const cellValue = record.getCellValue(field.id) as
    | ISingleSelectCellValue
    | IMultipleSelectCellValue;
  const attachStyle = useGridPopupPosition(rect, 340);

  useEffect(() => {
    if (isMultiple) {
      editorRef.current?.setValue?.(cellValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cellValue)]);

  useImperativeHandle(ref, () => ({
    focus: () => (editorRef.current || defaultFocusRef.current)?.focus?.(),
    setValue: (value?: string | string[]) => {
      editorRef.current?.setValue?.(value);
    },
  }));

  const selectOptions = useMemo(() => {
    const choices = (options as ISelectFieldOptions)?.choices || [];
    return choices.map(({ name, color }) => ({
      label: name,
      value: name,
      color:
        displayChoiceMap[name]?.color ??
        (ColorUtils.shouldUseLightTextOnColor(color) ? colors.white : colors.black),
      backgroundColor: displayChoiceMap[name]?.backgroundColor ?? ColorUtils.getHexForColor(color),
    }));
  }, [options, displayChoiceMap]);

  const onChange = (value?: string[] | string) => {
    record.updateCell(fieldId, isMultiple && value?.length === 0 ? null : value);
    if (!isMultiple) setTimeout(() => setEditing?.(false));
  };

  const onOptionAdd = useCallback(
    async (name: string) => {
      if (!tableId) return;

      const { choices = [] } = options as ISelectFieldOptions;
      const existColors = choices.map((v) => v.color);
      const choice = {
        name,
        color: ColorUtils.randomColor(existColors)[0],
      } as ISelectFieldChoice;

      const newChoices = [...choices, choice];

      await Field.convertField(tableId, fieldId, {
        type: fieldType,
        options: { ...options, choices: newChoices },
      });
    },
    [tableId, fieldType, fieldId, options]
  );

  return (
    <>
      {isEditing ? (
        <SelectEditorMain
          ref={editorRef}
          style={{
            ...style,
            ...attachStyle,
            height: 'auto',
          }}
          className="absolute rounded-sm border p-2 shadow-sm"
          value={cellValue === null ? undefined : cellValue}
          isMultiple={isMultiple}
          preventAutoNewOptions={(options as ISelectFieldOptions)?.preventAutoNewOptions}
          options={selectOptions}
          onChange={onChange}
          onOptionAdd={onOptionAdd}
        />
      ) : (
        <input className="size-0 opacity-0" ref={defaultFocusRef} />
      )}
    </>
  );
};

export const GridSelectEditor = forwardRef(GridSelectEditorBase);
