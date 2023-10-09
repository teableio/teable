import type {
  IAttachmentCellValue,
  ICheckboxCellValue,
  IDateCellValue,
  ILinkCellValue,
  ILinkFieldOptions,
  IMultipleSelectCellValue,
  INumberCellValue,
  INumberFieldOptions,
  IRatingFieldOptions,
  ISelectFieldOptions,
  ISingleLineTextCellValue,
  ISingleLineTextFieldOptions,
  ISingleSelectCellValue,
} from '@teable-group/core';
import { ColorUtils, FieldType } from '@teable-group/core';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AttachmentEditor,
  CheckboxEditor,
  DateEditor,
  NumberEditor,
  SelectEditor,
  TextEditor,
  RatingEditor,
} from '../editor';
import type { IEditorRef } from '../editor/type';
import { LinkEditor } from './LinkEditor';
import type { ICellValueEditor } from './type';

export const CellEditorMain = (props: ICellValueEditor) => {
  const { field, cellValue, onChange, disabled } = props;
  const { type, options } = field;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<IEditorRef<any>>(null);

  useEffect(() => {
    editorRef?.current?.setValue?.(cellValue);
  }, [cellValue]);

  const selectOptions = useCallback((options: ISelectFieldOptions) => {
    return options.choices.map(({ name, color }) => ({
      label: name,
      value: name,
      color: ColorUtils.shouldUseLightTextOnColor(color) ? '#ffffff' : '#000000',
      backgroundColor: ColorUtils.getHexForColor(color),
    }));
  }, []);

  return useMemo(() => {
    switch (type) {
      case FieldType.SingleLineText: {
        return (
          <TextEditor
            ref={editorRef}
            className="h-8"
            value={cellValue as ISingleLineTextCellValue}
            options={options as ISingleLineTextFieldOptions}
            onChange={onChange}
            disabled={disabled}
          />
        );
      }
      case FieldType.Number: {
        return (
          <NumberEditor
            ref={editorRef}
            className="h-8"
            options={options as INumberFieldOptions}
            value={cellValue as INumberCellValue}
            onChange={onChange}
            disabled={disabled}
          />
        );
      }
      case FieldType.Rating: {
        return (
          <RatingEditor
            className="h-8"
            options={options as IRatingFieldOptions}
            value={cellValue as INumberCellValue}
            onChange={onChange}
            disabled={disabled}
          />
        );
      }
      case FieldType.SingleSelect: {
        return (
          <SelectEditor
            value={cellValue as ISingleSelectCellValue}
            options={selectOptions(options as ISelectFieldOptions)}
            onChange={onChange}
            disabled={disabled}
          />
        );
      }
      case FieldType.MultipleSelect: {
        return (
          <SelectEditor
            value={cellValue as IMultipleSelectCellValue}
            options={selectOptions(options as ISelectFieldOptions)}
            onChange={onChange}
            isMultiple
            disabled={disabled}
          />
        );
      }
      case FieldType.Checkbox: {
        return (
          // Setting the checkbox size is affected by the font-size causing the height to change.
          <div style={{ fontSize: 0 }}>
            <CheckboxEditor
              className="w-6 h-6"
              value={cellValue as ICheckboxCellValue}
              onChange={onChange}
              disabled={disabled}
            />
          </div>
        );
      }
      case FieldType.Date: {
        return (
          <DateEditor
            className="w-44"
            value={cellValue ? new Date(cellValue as IDateCellValue) : undefined}
            onChange={(selectedDay) => onChange?.(selectedDay ? selectedDay.toISOString() : null)}
          />
        );
      }
      case FieldType.Attachment: {
        return (
          <AttachmentEditor
            value={cellValue as IAttachmentCellValue}
            onChange={onChange}
            disabled={disabled}
          />
        );
      }
      case FieldType.Link: {
        return (
          <LinkEditor
            cellValue={cellValue as ILinkCellValue | ILinkCellValue[]}
            options={options as ILinkFieldOptions}
            onChange={onChange}
            disabled={disabled}
          />
        );
      }
      default:
        throw new Error(`The field type (${type}) is not implemented editor`);
    }
  }, [type, cellValue, onChange, disabled, selectOptions, options]);
};
