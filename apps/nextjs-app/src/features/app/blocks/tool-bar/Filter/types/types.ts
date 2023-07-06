import type { IFilter, IFilterItem, IFilterGroupItem } from '@teable-group/core';

// enum OperatorType {
//   // common
//   Is = 'is',
//   IsNot = 'isNot',
//   IsEmpty = 'isEmpty',
//   IsNotEmpty = 'isNotEmpty',
//   Contains = 'contains',
//   DoesNotContain = 'doesNotContain',

//   // Link
//   HasAnyOf = 'hasAnyOf',
//   HasAllOf = 'hasAllOf',
//   IsExactly = 'isExactly',
//   HasNoneOf = 'hasNoneOf',

//   // attachment
//   FileNamesContain = 'fileNamesContain',
//   HasFileType = 'hasFileType',

//   // date
//   Today = 'today',
//   Tomorrow = 'tomorrow',
//   Yesterday = 'yesterday',
//   IsWithIn = 'isWithIn',
//   IsBefore = 'isBefore',
//   IsAfter = 'isAfter',
//   IsOnOrBefore = 'isOnOrBefore',
// }

interface IFilterProps {
  filters: IFilter;
  onChange?: (filters: IFilter) => void;
}

interface IConditionProps {
  index: number;
  filter: IFilterItem;
  parent: IFilter;
  level: number;
}

interface IConditionGroupProps {
  index: number;
  filter: IFilterGroupItem;
  parent: IFilter;
  level: number;
}

export type {
  IFilterProps,
  IFilterItem,
  IFilterGroupItem,
  IConditionProps,
  IConditionGroupProps,
  IFilter,
};
