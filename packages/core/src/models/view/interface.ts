import type { FilterConjunction, FilterDuration, ViewType, FOperator } from './constant';

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

export interface IGroup {
  rules: ISortedField[];
}

export type ISort = {
  rules: ISortedField[];
  keepSort: boolean;
};

interface IBaseFilterItem {
  id: string;
}

export interface IFilterItem extends IBaseFilterItem {
  columnId?: string;
  operator: FOperator;
  value: unknown;
}
export interface IFilterGroupItem extends IBaseFilterItem {
  type: 'Nested';
  conjunction: FilterConjunction;
  filterSet: (IFilterItem | IFilterGroupItem)[];
}

export interface IFilter {
  conjunction: FilterConjunction;
  filterSet: (IFilterItem | IFilterGroupItem)[];
}

export interface IViewRo {
  name: string;
  type: ViewType;
  description?: string;
  filter?: IFilter;
  sort?: ISort;
  order?: number;
  group?: IGroup;
  options?: unknown;
}

export interface IViewVo extends IViewRo {
  id: string;
  order: number;
}

export interface IViewSnapshot {
  view: IViewVo;
}
