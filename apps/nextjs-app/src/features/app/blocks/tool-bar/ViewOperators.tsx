import type { IFilter } from '@teable-group/core';
import {
  ArrowUpDown,
  LayoutList,
  PaintBucket,
  Filter as FilterIcon,
  EyeOff,
} from '@teable-group/icons';
import { Filter, HideFields, RowHeight } from '@teable-group/sdk';
import { useView } from '@teable-group/sdk/hooks/use-view';
import { useToast } from '@teable-group/ui-lib';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import classNames from 'classnames';
import { useCallback } from 'react';
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';

export const ViewOperators: React.FC = () => {
  const view = useView();
  const { toast } = useToast();

  const onFilterChange = useCallback(
    async (filters: IFilter | null) => {
      await view?.setFilter(filters).catch((e) => {
        let message;
        if (e instanceof z.ZodError) {
          message = fromZodError(e).message;
        } else {
          message = e.message;
        }
        toast({
          variant: 'destructive',
          title: 'Uh oh! Something went wrong.',
          description: message,
        });
      });
    },
    [toast, view]
  );

  return (
    <div className="flex gap-1">
      <HideFields>
        {(text, isActive) => (
          <Button
            variant={'ghost'}
            size={'xs'}
            className={classNames('font-normal', { 'bg-secondary': isActive })}
          >
            <EyeOff className="text-sm w-4 h-4" />
            {text}
          </Button>
        )}
      </HideFields>
      <Filter filters={view?.filter as IFilter} onChange={onFilterChange}>
        {(text, isActive) => (
          <Button
            variant={'ghost'}
            size={'xs'}
            className={classNames('font-normal', { 'bg-secondary': isActive })}
          >
            <FilterIcon className="text-sm w-4 h-4" />
            <span className="truncate">{text}</span>
          </Button>
        )}
      </Filter>
      <Button className="font-normal" size={'xs'} variant={'ghost'}>
        <ArrowUpDown className="text-sm w-4 h-4" />
        Sort
      </Button>
      <Button className="font-normal" size={'xs'} variant={'ghost'}>
        <LayoutList className="text-sm w-4 h-4" />
        Group
      </Button>
      <Button className="font-normal" size={'xs'} variant={'ghost'}>
        <PaintBucket className="text-sm w-4 h-4" />
        Color
      </Button>
      <RowHeight>
        {(text, isActive, Icon) => (
          <Button
            variant={'ghost'}
            size={'xs'}
            className={classNames('font-normal capitalize', {
              'bg-secondary': isActive,
            })}
          >
            <Icon className="text-sm" />
            {text}
          </Button>
        )}
      </RowHeight>
    </div>
  );
};
