import type {
  IUserCellValue,
  IAttachmentCellValue,
  ISingleSelectCellValue,
  IMultipleSelectCellValue,
  INumberFormatting,
  IRatingFieldOptions,
  IDatetimeFormatting,
  ILinkCellValue,
} from '@teable/core';
import { CellValueType, FieldType } from '@teable/core';
import type { IFieldInstance } from '../../model';
import { CellAttachment } from './cell-attachment';
import { CellCheckbox } from './cell-checkbox';
import { CellDate } from './cell-date';
import { CellLink } from './cell-link';
import { CellNumber } from './cell-number';
import { CellRating } from './cell-rating';
import { CellSelect, transformSelectOptions } from './cell-select';
import { CellText } from './cell-text';
import { CellUser } from './cell-user';
import type { ICellValue } from './type';

interface ICellValueContainer extends ICellValue<unknown> {
  field: IFieldInstance;
}

export const CellValue = (props: ICellValueContainer) => {
  const { field, value, className } = props;
  const { type, options, cellValueType } = field;

  switch (type) {
    case FieldType.LongText:
    case FieldType.SingleLineText: {
      return (
        <CellText
          value={value as string}
          isMultipleRows={type === FieldType.LongText}
          className={className}
        />
      );
    }
    case FieldType.Number: {
      return (
        <CellNumber
          value={value as number}
          formatting={options.formatting as INumberFormatting}
          className={className}
        />
      );
    }
    case FieldType.AutoNumber: {
      return <CellNumber value={value as number} className={className} />;
    }
    case FieldType.Date:
    case FieldType.CreatedTime:
    case FieldType.LastModifiedTime: {
      return (
        <CellDate value={value as string} formatting={options.formatting} className={className} />
      );
    }
    case FieldType.SingleSelect:
    case FieldType.MultipleSelect: {
      return (
        <CellSelect
          value={value as ISingleSelectCellValue | IMultipleSelectCellValue}
          options={transformSelectOptions(options)}
          className={className}
        />
      );
    }
    case FieldType.User: {
      return <CellUser value={value as IUserCellValue | IUserCellValue[]} className={className} />;
    }
    case FieldType.Attachment: {
      return <CellAttachment value={value as IAttachmentCellValue} className={className} />;
    }
    case FieldType.Rating: {
      return (
        <CellRating
          value={value as number}
          options={options as IRatingFieldOptions}
          className={className}
        />
      );
    }
    case FieldType.Checkbox: {
      return <CellCheckbox value={value as boolean | boolean[]} className={className} />;
    }
    case FieldType.Formula: {
      if (cellValueType === CellValueType.Boolean) {
        return <CellCheckbox value={value as boolean | boolean[]} className={className} />;
      }

      if (cellValueType === CellValueType.DateTime) {
        return (
          <CellDate
            value={value as string}
            formatting={options.formatting as IDatetimeFormatting}
            className={className}
          />
        );
      }

      if (cellValueType === CellValueType.Number) {
        return (
          <CellNumber
            value={value as number}
            formatting={options.formatting as INumberFormatting}
            className={className}
          />
        );
      }

      return <CellText value={value as string} className={className} />;
    }
    case FieldType.Link: {
      return <CellLink value={value as ILinkCellValue | ILinkCellValue[]} className={className} />;
    }
    default:
      throw new Error(`The field type (${type}) is not implemented editor`);
  }
};
