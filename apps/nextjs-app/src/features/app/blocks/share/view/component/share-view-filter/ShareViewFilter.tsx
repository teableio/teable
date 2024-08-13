import { FieldType } from '@teable/core';
import { ViewFilter } from '@teable/sdk/components';
import { FieldValue } from '@teable/sdk/components/filter/view-filter/custom-component';
import { type ComponentProps } from 'react';
import { FilterLink } from './filter-link';
import { FilterUser } from './FilterUser';

type IShareViewFilterProps = ComponentProps<typeof ViewFilter>;
type ICustomerValueComponentProps = ComponentProps<typeof FieldValue>;

const CustomValueComponent = (props: ICustomerValueComponentProps) => {
  const components = {
    [FieldType.User]: FilterUser,
    [FieldType.CreatedBy]: FilterUser,
    [FieldType.LastModifiedBy]: FilterUser,
    [FieldType.Link]: FilterLink,
  };
  return <FieldValue {...props} components={components} />;
};

export const ShareViewFilter = (props: IShareViewFilterProps) => {
  return <ViewFilter {...props} customValueComponent={CustomValueComponent} />;
};
