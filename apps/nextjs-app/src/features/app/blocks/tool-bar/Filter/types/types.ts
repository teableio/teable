import type { IFilter, IFilterMeta, IFilterSet } from '@teable-group/core';

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
  filter: IFilterMeta;
  parent: IFilter;
}

interface IConditionGroupProps {
  index: number;
  filter: IFilterSet;
  parent: IFilter;
  level: number;
}

export type { IFilterProps, IConditionProps, IConditionGroupProps, IFilter };
