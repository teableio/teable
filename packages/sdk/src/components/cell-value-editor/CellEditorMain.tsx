import type {
  IAttachmentCellValue,
  ICheckboxCellValue,
  IDateFieldOptions,
  ILinkCellValue,
  ILinkFieldOptions,
  ILongTextCellValue,
  IMultipleSelectCellValue,
  INumberCellValue,
  IRatingFieldOptions,
  ISelectFieldChoice,
  ISelectFieldOptions,
  ISingleLineTextCellValue,
  ISingleLineTextFieldOptions,
  ISingleSelectCellValue,
  IUserCellValue,
  IUserFieldOptions,
} from '@teable/core';
import { ColorUtils, FieldType } from '@teable/core';
import { useCallback, useEffect, useRef } from 'react';
import { useTableId } from '../../hooks';
import { Field } from '../../model';
import { transformSelectOptions } from '../cell-value';
import {
  AttachmentEditor,
  CheckboxEditor,
  DateEditor,
  NumberEditor,
  SelectEditor,
  TextEditor,
  RatingEditor,
  LongTextEditor,
  LinkEditor,
  UserEditor,
} from '../editor';
import type { IEditorRef } from '../editor/type';
import type { ICellValueEditor } from './type';

export const CellEditorMain = (props: Omit<ICellValueEditor, 'wrapClassName' | 'wrapStyle'>) => {
  const { field, recordId, cellValue, onChange, readonly, className, context } = props;
  const tableId = useTableId();
  const { id: fieldId, type, options } = field;
  const editorRef = useRef<IEditorRef<unknown>>(null);

  useEffect(() => {
    editorRef?.current?.setValue?.(cellValue);
  }, [cellValue]);

  const onOptionAdd = useCallback(
    async (name: string) => {
      if (!tableId) return;
      if (type !== FieldType.SingleSelect && type !== FieldType.MultipleSelect) return;

      const { choices = [] } = options as ISelectFieldOptions;
      const existColors = choices.map((v) => v.color);
      const choice = {
        name,
        color: ColorUtils.randomColor(existColors)[0],
      } as ISelectFieldChoice;

      const newChoices = [...choices, choice];

      await Field.convertField(tableId, fieldId, {
        type,
        options: { ...options, choices: newChoices },
      });
    },
    [tableId, type, fieldId, options]
  );

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
          ref={editorRef}
          className={className}
          value={cellValue as ISingleSelectCellValue}
          preventAutoNewOptions={(options as ISelectFieldOptions).preventAutoNewOptions}
          options={transformSelectOptions((options as ISelectFieldOptions).choices)}
          onChange={onChange}
          readonly={readonly}
          onOptionAdd={onOptionAdd}
        />
      );
    }
    case FieldType.MultipleSelect: {
      return (
        <SelectEditor
          ref={editorRef}
          className={className}
          value={cellValue as IMultipleSelectCellValue}
          options={transformSelectOptions((options as ISelectFieldOptions).choices)}
          onChange={onChange}
          isMultiple
          readonly={readonly}
          onOptionAdd={onOptionAdd}
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
          ref={editorRef}
          className={className}
          options={options as IDateFieldOptions}
          value={cellValue as string}
          onChange={(selectedDay) => onChange?.(selectedDay ?? null)}
          readonly={readonly}
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
    case FieldType.User:
    case FieldType.CreatedBy:
    case FieldType.LastModifiedBy: {
      return (
        <UserEditor
          className={className}
          value={cellValue as IUserCellValue | IUserCellValue[]}
          options={options as IUserFieldOptions}
          onChange={onChange}
          readonly={readonly}
          context={context}
        />
      );
    }
    default:
      throw new Error(`The field type (${type}) is not implemented editor`);
  }
};
