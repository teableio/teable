import type { FieldType } from '@teable/core';
import type { IFilterComponents } from '@teable/sdk/components';
import {
  FilterLinkBase,
  FilterLinkSelect,
} from '@teable/sdk/components/filter/view-filter/component';
import { FilterLinkSelectList } from './FilterLinkSelectList';
import { FilterLinkSelectTrigger } from './FilterLinkSelectTrigger';

const FilterLinkSelectCom: IFilterComponents[FieldType.Link] = (props) => {
  return (
    <FilterLinkSelect
      {...props}
      components={{
        Trigger: FilterLinkSelectTrigger,
        List: FilterLinkSelectList,
      }}
    />
  );
};

export const FilterLink: IFilterComponents[FieldType.Link] = (props) => {
  return (
    <FilterLinkBase
      {...props}
      components={{
        Select: FilterLinkSelectCom,
      }}
    />
  );
};
