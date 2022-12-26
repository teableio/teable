import type { StatisticsFunc, FilterConjunction, FilterDuration, ViewType } from './constant';

export type IFilterCheckbox = [boolean] | null;
export type IFilterText = [string] | null;
export type IFilterNumber = [string] | null;
export type IFilterSingleSelect = string[] | null;
export type IFilterMultiSelect = string[] | null;
export type IFilterMember = string[] | null;

export type IFilterDateTime =
  | [Exclude<FilterDuration, FilterDuration.ExactDate>]
  | [FilterDuration.ExactDate, number | null]
  | null;

// interface ILongTextCondition{
//   fieldType: FieldType.LongText;
//   value: IFilterText;
// };
// interface ISingleLineTextCondition{
//   fieldType: FieldType.SingleLineText;
//   value: IFilterText;
// };
// interface INumberCondition{
//   fieldType: FieldType.Number;
//   value: IFilterNumber;
// };
// interface ICurrencyCondition{
//   fieldType: FieldType.Currency;
//   value: IFilterNumber;
// };
// interface IPercentCondition{
//   fieldType: FieldType.Percent;
//   value: IFilterNumber;
// };
// interface IAutoNumberCondition{
//   fieldType: FieldType.AutoNumber;
//   value: IFilterNumber;
// };
// interface ISingleSelectCondition{
//   fieldType: FieldType.SingleSelect;
//   value: IFilterSingleSelect;
// };
// interface IMultipleSelectCondition{
//   fieldType: FieldType.MultipleSelect;
//   value: IFilterMultiSelect;
// };
// interface IDateCondition{
//   fieldType: FieldType.Date;
//   value: IFilterDateTime;
// };
// interface ICreatedTimeCondition{
//   fieldType: FieldType.CreatedTime;
//   value: IFilterDateTime;
// };
// interface ILastModifiedTimeCondition{
//   fieldType: FieldType.LastModifiedTime;
//   value: IFilterDateTime;
// };
// interface IAttachmentCondition{
//   fieldType: FieldType.Attachment;
//   value: any;
//   };
// interface IMultipleRecordLinksCondition{
//   fieldType: FieldType.MultipleRecordLinks;
//   value: any;
// };
// interface IURLCondition{
//   fieldType: FieldType.URL;
//   value: any;
// };
// interface IEmailCondition{
//   fieldType: FieldType.Email;
//   value: any;
// };
// interface IPhoneNumberCondition{
//   fieldType: FieldType.PhoneNumber;
//   value: IFilterText;
// };
// interface ICheckboxCondition{
//   fieldType: FieldType.Checkbox;
//   value: IFilterCheckbox;
// };
// interface IRatingCondition{
//   fieldType: FieldType.Rating;
//   value: IFilterNumber;
// };
// interface ICountCondition{
//   fieldType: FieldType.Count;
//   value: IFilterNumber;
// };
// interface IUserCondition{
//   fieldType: FieldType.User;
//   value: IFilterMember;
// };
// interface ICreatedByCondition{
//   fieldType: FieldType.CreatedBy;
//   value: IFilterMember;
// };
// interface ILastModifiedByCondition{
//   fieldType: FieldType.LastModifiedBy;
//   value: IFilterMember;
// };
// interface IMultipleLookupValuesCondition{
//   fieldType: FieldType.MultipleLookupValues;
//   value: any;
// };
// interface IFormulaCondition{
//   fieldType: FieldType.Formula;
//   value: IFilterText;
// };

export interface ISortedField {
  fieldId: string;
  desc: boolean;
}

export type IGroup = ISortedField[];

export type ISort = {
  rules: ISortedField[];
  keepSort: boolean;
};

export interface IFilter {
  conjunction: FilterConjunction;
  conditions: unknown;
}

export interface IColumn {
  fieldId: string;
  width?: number;
  hidden?: boolean;
  statisticFunc?: StatisticsFunc;
}

export interface IRow {
  recordId: string;
}

export interface IViewBase {
  id: string;
  name: string;
  type: ViewType;
  rows: IRow[];
  description?: string;
  filter?: IFilter;
  sort?: ISort;
  options?: unknown;
}

export interface IGridView extends IViewBase {
  type: ViewType.Grid;
  columns: IColumn[];
}

export interface IGalleryView extends IViewBase {
  type: ViewType.Gallery;
  columns: {
    fieldId: string;
    hidden: boolean;
  }[];
}

export type IView = IGridView | IGalleryView;
