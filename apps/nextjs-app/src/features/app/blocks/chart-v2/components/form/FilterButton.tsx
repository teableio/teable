import type { IFilter } from '@teable/core';
import { Filter } from '@teable/icons';
import type { ITableQuery } from '@teable/openapi';
import { FieldContext } from '@teable/sdk/context';
import type { IViewFilterConditionItem } from '@teable/sdk/index';
import { BaseViewFilter, createFieldInstance, useViewFilterLinkContext } from '@teable/sdk/index';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@teable/ui-lib/shadcn';
import { get } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useFields, useStorage } from '../../hooks';
import { FormLabel } from './FormLabel';

export const FilterButton = () => {
  const { t } = useTranslation('chart');
  const { storage, updateStorageByPath } = useStorage();
  const { fields } = useFields();
  const fieldInstances = fields.map((field) => createFieldInstance(field));
  const filter = (get(storage, 'query.filter') as unknown as IFilter) || null;
  const tableId = (storage?.query as unknown as ITableQuery)?.tableId;
  const viewId = (storage?.query as unknown as ITableQuery)?.viewId;

  const onChange = (value: IFilter | null) => {
    updateStorageByPath('query.filter', value);
  };

  const displayFilterLength = useMemo(() => {
    if (!filter) {
      return false;
    }

    if (filter.filterSet.length > 0) {
      return true;
    }

    return false;
  }, [filter]);

  const filterLength = useMemo(() => {
    if (!filter) {
      return 0;
    }
    return filter.filterSet.length;
  }, [filter]);

  const viewFilterLinkContext = useViewFilterLinkContext(tableId, viewId, {
    disabled: false,
    preventGlobalError: true,
  });

  return (
    <FormLabel label={t('chartV2.form.filter.title')}>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">
            <div className="flex items-center gap-1">
              <Filter className="size-4" />
              {t('chartV2.form.filter.addFilter')}
              {displayFilterLength && <span>({filterLength})</span>}
            </div>
          </Button>
        </DialogTrigger>
        <DialogContent className="flex max-h-[50vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{t('chartV2.form.filter.title')}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <FieldContext.Provider value={{ fields: fieldInstances }}>
              <BaseViewFilter<IViewFilterConditionItem>
                fields={fieldInstances}
                value={filter}
                onChange={onChange}
                viewFilterLinkContext={viewFilterLinkContext}
              />
            </FieldContext.Provider>
          </div>
        </DialogContent>
      </Dialog>
    </FormLabel>
  );
};
