import type {
  IAttachmentCellValue,
  ICheckboxCellValue,
  IDateCellValue,
  IDateFieldOptions,
  ILinkCellValue,
  ILinkFieldOptions,
  ILongTextCellValue,
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
  LongTextEditor,
} from '../editor';
import { LinkEditor } from '../editor/link';
import type { IEditorRef } from '../editor/type';
import type { ICellValueEditor } from './type';

export const CellEditorMain = (props: Omit<ICellValueEditor, 'wrapClassName' | 'wrapStyle'>) => {
  const { field, recordId, cellValue, onChange, readonly, className } = props;
  const { type, options } = field;
  const editorRef = useRef<IEditorRef<unknown>>(null);

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
            className={className}
            value={cellValue as ISingleLineTextCellValue}
            options={options as ISingleLineTextFieldOptions}
            onChange={onChange}
            readonly={readonly}
          />
        );
      }
      case FieldType.LongText: {
        return (
          <LongTextEditor
            ref={editorRef}
            className={className}
            value={cellValue as ILongTextCellValue}
            onChange={onChange}
            readonly={readonly}
          />
        );
      }
      case FieldType.Number: {
        return (
          <NumberEditor
            ref={editorRef}
            className={className}
            options={options as INumberFieldOptions}
            value={cellValue as INumberCellValue}
            onChange={onChange}
            readonly={readonly}
          />
        );
      }
      case FieldType.Rating: {
        return (
          <RatingEditor
            className={className}
            options={options as IRatingFieldOptions}
            value={cellValue as INumberCellValue}
            onChange={onChange}
            readonly={readonly}
          />
        );
      }
      case FieldType.SingleSelect: {
        return (
          <SelectEditor
            className={className}
            value={cellValue as ISingleSelectCellValue}
            options={selectOptions(options as ISelectFieldOptions)}
            onChange={onChange}
            readonly={readonly}
          />
        );
      }
      case FieldType.MultipleSelect: {
        return (
          <SelectEditor
            className={className}
            value={cellValue as IMultipleSelectCellValue}
            options={selectOptions(options as ISelectFieldOptions)}
            onChange={onChange}
            isMultiple
            readonly={readonly}
          />
        );
      }
      case FieldType.Checkbox: {
        return (
          // Setting the checkbox size is affected by the font-size causing the height to change.
          <div style={{ fontSize: 0 }}>
            <CheckboxEditor
              className={className}
              value={cellValue as ICheckboxCellValue}
              onChange={onChange}
              readonly={readonly}
            />
          </div>
        );
      }
      case FieldType.Date: {
        return (
          <DateEditor
            className={className}
            options={options as IDateFieldOptions}
            value={cellValue ? new Date(cellValue as IDateCellValue) : undefined}
            onChange={(selectedDay) => onChange?.(selectedDay ? selectedDay.toISOString() : null)}
          />
        );
      }
      case FieldType.Attachment: {
        return (
          <AttachmentEditor
            className={className}
            value={cellValue as IAttachmentCellValue}
            onChange={onChange}
            readonly={readonly}
          />
        );
      }
      case FieldType.Link: {
        return (
          <LinkEditor
            className={className}
            cellValue={cellValue as ILinkCellValue | ILinkCellValue[]}
            options={options as ILinkFieldOptions}
            onChange={onChange}
            readonly={readonly}
            fieldId={field.id}
            recordId={recordId}
          />
        );
      }
      default:
        throw new Error(`The field type (${type}) is not implemented editor`);
    }
  }, [type, className, cellValue, options, onChange, readonly, selectOptions, field.id, recordId]);
};
