import type {
  IUserCellValue,
  IAttachmentCellValue,
  ISingleSelectCellValue,
  IMultipleSelectCellValue,
  INumberFormatting,
  IRatingFieldOptions,
  IDatetimeFormatting,
  ILinkCellValue,
  ISelectFieldOptions,
  SingleLineTextDisplayType,
  IButtonFieldCellValue,
  IButtonFieldOptions,
} from '@teable/core';
import { CellValueType, FieldType } from '@teable/core';
import { cn } from '@teable/ui-lib';
import type { IFieldInstance } from '../../model';
import { CellAttachment } from './cell-attachment';
import { CellButton } from './cell-button';
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
  readonly?: boolean;
}

interface RenderContext {
  field: IFieldInstance;
  value: unknown;
  options: Record<string, unknown>;
  ellipsis?: boolean;
  className?: string;
  itemClassName?: string;
  formatImageUrl?: (url: string) => string;
  readonly?: boolean;
}

type RenderFn = (ctx: RenderContext) => JSX.Element;

const renderLongText: RenderFn = ({ value, className, ellipsis }) => (
  <CellText
    value={value as string}
    className={cn(className, 'line-clamp-none')}
    ellipsis={ellipsis}
  />
);

const renderSingleLineText: RenderFn = ({ value, className, ellipsis, options }) => (
  <CellText
    value={value as string}
    className={className}
    ellipsis={ellipsis}
    displayType={(options as { showAs?: { type?: SingleLineTextDisplayType } })?.showAs?.type}
  />
);

const renderNumber: RenderFn = ({ value, className, ellipsis, options }) => (
  <CellNumber
    value={value as number}
    formatting={options.formatting as INumberFormatting}
    className={className}
    ellipsis={ellipsis}
  />
);

const renderAutoNumber: RenderFn = ({ value, className, ellipsis }) => (
  <CellNumber value={value as number} ellipsis={ellipsis} className={className} />
);

const renderDate: RenderFn = ({ value, className, ellipsis, options }) => (
  <CellDate
    value={value as string}
    formatting={options.formatting as IDatetimeFormatting}
    ellipsis={ellipsis}
    className={className}
  />
);

const renderSelect: RenderFn = ({ value, className, ellipsis, itemClassName, options }) => (
  <CellSelect
    value={value as ISingleSelectCellValue | IMultipleSelectCellValue}
    options={transformSelectOptions(
      (options as { choices?: ISelectFieldOptions['choices'] }).choices ?? []
    )}
    className={className}
    itemClassName={itemClassName}
    ellipsis={ellipsis}
  />
);

const renderUser: RenderFn = ({ value, className, itemClassName, formatImageUrl }) => (
  <CellUser
    value={value as IUserCellValue | IUserCellValue[]}
    className={className}
    itemClassName={itemClassName}
    formatImageUrl={formatImageUrl}
  />
);

const renderAttachment: RenderFn = ({ value, className, itemClassName, formatImageUrl }) => (
  <CellAttachment
    value={value as IAttachmentCellValue}
    className={className}
    itemClassName={itemClassName}
    formatImageUrl={formatImageUrl}
  />
);

const renderRating: RenderFn = ({ value, className, itemClassName, ellipsis, options }) => {
  const ratingOptions = options as Partial<IRatingFieldOptions>;
  if (ratingOptions.icon == null || ratingOptions.color == null || ratingOptions.max == null) {
    return <CellNumber value={value as number} ellipsis={ellipsis} className={className} />;
  }
  return (
    <CellRating
      value={value as number}
      options={ratingOptions as IRatingFieldOptions}
      className={className}
      itemClassName={itemClassName}
    />
  );
};

const renderCheckbox: RenderFn = ({ value, className }) => (
  <CellCheckbox value={value as boolean | boolean[]} className={className} />
);

const renderButton: RenderFn = ({ value, className, ellipsis, options, readonly, field }) => {
  const buttonOptions = options as Partial<IButtonFieldOptions>;
  if (buttonOptions.label == null || buttonOptions.color == null) {
    const buttonValue = Array.isArray(value)
      ? (value as IButtonFieldCellValue[])
          .map((item) => item?.count)
          .filter((count) => typeof count === 'number')
          .join(', ')
      : typeof (value as IButtonFieldCellValue | undefined)?.count === 'number'
        ? String((value as IButtonFieldCellValue).count)
        : '';
    return <CellText value={buttonValue} className={className} ellipsis={ellipsis} />;
  }
  return (
    <CellButton
      value={value as IButtonFieldCellValue}
      className={className}
      options={buttonOptions as IButtonFieldOptions}
      readonly={readonly}
      isLookup={field.isLookup}
    />
  );
};

const renderFormulaLike: RenderFn = ({ value, className, ellipsis, options, field }) => {
  if (field.cellValueType === CellValueType.Boolean) {
    return <CellCheckbox value={value as boolean | boolean[]} className={className} />;
  }

  if (field.cellValueType === CellValueType.DateTime) {
    return (
      <CellDate
        value={value as string}
        formatting={options.formatting as IDatetimeFormatting}
        className={className}
        ellipsis={ellipsis}
      />
    );
  }

  if (field.cellValueType === CellValueType.Number) {
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
      displayType={(options as { showAs?: { type?: SingleLineTextDisplayType } })?.showAs?.type}
    />
  );
};

const renderLink: RenderFn = ({ value, className, itemClassName }) => (
  <CellLink
    value={value as ILinkCellValue | ILinkCellValue[]}
    className={className}
    itemClassName={itemClassName}
  />
);

const typeRenderers: Partial<Record<FieldType, RenderFn>> = {
  [FieldType.LongText]: renderLongText,
  [FieldType.SingleLineText]: renderSingleLineText,
  [FieldType.Number]: renderNumber,
  [FieldType.AutoNumber]: renderAutoNumber,
  [FieldType.Date]: renderDate,
  [FieldType.CreatedTime]: renderDate,
  [FieldType.LastModifiedTime]: renderDate,
  [FieldType.SingleSelect]: renderSelect,
  [FieldType.MultipleSelect]: renderSelect,
  [FieldType.User]: renderUser,
  [FieldType.CreatedBy]: renderUser,
  [FieldType.LastModifiedBy]: renderUser,
  [FieldType.Attachment]: renderAttachment,
  [FieldType.Rating]: renderRating,
  [FieldType.Checkbox]: renderCheckbox,
  [FieldType.Button]: renderButton,
  [FieldType.Formula]: renderFormulaLike,
  [FieldType.Rollup]: renderFormulaLike,
  [FieldType.ConditionalRollup]: renderFormulaLike,
  [FieldType.Link]: renderLink,
};

export const CellValue = (props: ICellValueContainer) => {
  const { field, value, ellipsis, className, itemClassName, formatImageUrl, readonly } = props;
  const options = (field.options ?? {}) as Record<string, unknown>;
  const renderer = typeRenderers[field.type];

  if (!renderer) {
    throw new Error(`The field type (${field.type}) is not implemented cell value`);
  }

  return renderer({
    field,
    value,
    options,
    ellipsis,
    className,
    itemClassName,
    formatImageUrl,
    readonly,
  });
};
