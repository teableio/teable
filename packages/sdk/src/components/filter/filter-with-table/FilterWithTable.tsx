import type { IFilter } from '@teable/core';
import { FieldType } from '@teable/core';
import type { ComponentProps } from 'react';
import type { IFieldInstance } from '../../../model';
import type { IViewFilterLinkContext } from '../view-filter';
import { BaseViewFilter, FieldValue } from '../view-filter';
import { FilterLinkBase, FilterLinkSelect, StandDefaultList } from '../view-filter/component';
import { FilterLinkContext } from '../view-filter/component/filter-link/context';
import type { IFilterLinkProps } from '../view-filter/component/filter-link/types';
import type { IFilterReferenceSource } from '../view-filter/custom-component/BaseFieldValue';

interface IFilterWithTableProps {
  value: IFilter | null;
  fields: IFieldInstance[];
  context: IViewFilterLinkContext;
  onChange: (value: IFilter | null) => void;
  referenceSource?: IFilterReferenceSource;
}

type ICustomerValueComponentProps = ComponentProps<typeof FieldValue>;

const FilterLinkSelectCom = (props: IFilterLinkProps) => {
  return (
    <FilterLinkSelect
      {...props}
      modal={true}
      components={{
        List: StandDefaultList,
      }}
    />
  );
};

const FilterLink = (props: IFilterLinkProps) => {
  return (
    <FilterLinkContext.Provider value={{ context: props.context }}>
      <FilterLinkBase
        {...props}
        components={{
          Select: FilterLinkSelectCom,
        }}
      />
    </FilterLinkContext.Provider>
  );
};

export const FilterWithTable = (props: IFilterWithTableProps) => {
  const { fields, value, context, onChange, referenceSource } = props;

  const CustomValueComponent = (valueProps: ICustomerValueComponentProps) => {
    const components = {
      [FieldType.Link]: FilterLink,
    };
    return (
      <FieldValue
        {...valueProps}
        components={components}
        modal={true}
        referenceSource={referenceSource}
      />
    );
  };

  return (
    <BaseViewFilter
      modal={true}
      value={value}
      fields={fields}
      onChange={onChange}
      viewFilterLinkContext={context}
      customValueComponent={CustomValueComponent}
    />
  );
};
