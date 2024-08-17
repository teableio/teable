import { Spin } from '@teable/ui-lib';
import { useContext } from 'react';
import { useTranslation } from '../../../../../context/app/i18n';
import { SelectTag } from '../../../../cell-value';
import { FilterLinkContext } from './context';
import { StorageLinkSelected } from './storage';
import type { IFilterLinkProps } from './types';

export const DefaultTrigger = (props: IFilterLinkProps) => {
  const { value, field } = props;
  const { t } = useTranslation();
  const foreignTableId = field.options.foreignTableId;

  const { context } = useContext(FilterLinkContext);

  const values = typeof value === 'string' ? [value] : value;
  const recordMap = context?.data?.find((item) => item.tableId === foreignTableId)?.data;

  return context?.isLoading ? (
    <Spin className="size-4" />
  ) : value ? (
    values?.map((id) => (
      <SelectTag
        className="flex items-center"
        key={id}
        label={
          recordMap?.[id] ||
          StorageLinkSelected.get(`${field.options.foreignTableId}-${id}`) ||
          t('common.unnamedRecord')
        }
      />
    ))
  ) : (
    t('common.selectPlaceHolder')
  );
};
