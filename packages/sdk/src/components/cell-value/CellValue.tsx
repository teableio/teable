import type {
  IUserCellValue,
  IAttachmentCellValue,
  ISingleSelectCellValue,
  IMultipleSelectCellValue,
  INumberFormatting,
  IRatingFieldOptions,
  IDatetimeFormatting,
  ILinkCellValue,
  SingleLineTextDisplayType,
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
  formatImageUrl?: (url: string) => string;
  itemClassName?: string;
}

export const CellValue = (props: ICellValueContainer) => {
  const { field, value, ellipsis, className, itemClassName, formatImageUrl } = props;
  const { type, options, cellValueType } = field;

  switch (type) {
    case FieldType.LongText: {
      return <CellText value={value as string} className={className} ellipsis={ellipsis} />;
    }
    case FieldType.SingleLineText: {
      return (
        <CellText
          value={value as string}
          className={className}
          ellipsis={ellipsis}
          displayType={options.showAs?.type}
        />
      );
    }
    case FieldType.Number: {
      return (
        <CellNumber
          value={value as number}
          formatting={options.formatting as INumberFormatting}
          className={className}
          ellipsis={ellipsis}
        />
      );
    }
    case FieldType.AutoNumber: {
      return <CellNumber value={value as number} ellipsis={ellipsis} className={className} />;
    }
    case FieldType.Date:
    case FieldType.CreatedTime:
    case FieldType.LastModifiedTime: {
      return (
        <CellDate
          value={value as string}
          formatting={options.formatting}
          ellipsis={ellipsis}
          className={className}
        />
      );
    }
    case FieldType.SingleSelect:
    case FieldType.MultipleSelect: {
      return (
        <CellSelect
          value={value as ISingleSelectCellValue | IMultipleSelectCellValue}
          options={transformSelectOptions(options.choices)}
          className={className}
          itemClassName={itemClassName}
          ellipsis={ellipsis}
        />
      );
    }
    case FieldType.User:
    case FieldType.CreatedBy:
    case FieldType.LastModifiedBy: {
      return (
        <CellUser
          value={value as IUserCellValue | IUserCellValue[]}
          className={className}
          itemClassName={itemClassName}
          formatImageUrl={formatImageUrl}
        />
      );
    }
    case FieldType.Attachment: {
      return (
        <CellAttachment
          value={value as IAttachmentCellValue}
          className={className}
          itemClassName={itemClassName}
          formatImageUrl={formatImageUrl}
        />
      );
    }
    case FieldType.Rating: {
      return (
        <CellRating
          value={value as number}
          options={options as IRatingFieldOptions}
          className={className}
          itemClassName={itemClassName}
        />
      );
    }
    case FieldType.Checkbox: {
      return <CellCheckbox value={value as boolean | boolean[]} className={className} />;
    }
    case FieldType.Formula:
    case FieldType.Rollup: {
      if (cellValueType === CellValueType.Boolean) {
        return <CellCheckbox value={value as boolean | boolean[]} className={className} />;
      }

      if (cellValueType === CellValueType.DateTime) {
        return (
          <CellDate
            value={value as string}
            formatting={options.formatting as IDatetimeFormatting}
            className={className}
            ellipsis={ellipsis}
          />
        );
      }

      if (cellValueType === CellValueType.Number) {
        return (
          <CellNumber
            value={value as number}
            formatting={options.formatting as INumberFormatting}
            className={className}
            ellipsis={ellipsis}
          />
        );
      }

      return (
        <CellText
          value={value as string}
          className={className}
          ellipsis={ellipsis}
          displayType={options.showAs?.type as SingleLineTextDisplayType}
        />
      );
    }
    case FieldType.Link: {
      return (
        <CellLink
          value={value as ILinkCellValue | ILinkCellValue[]}
          className={className}
          itemClassName={itemClassName}
        />
      );
    }
    default:
      throw new Error(`The field type (${type}) is not implemented cell value`);
  }
};
