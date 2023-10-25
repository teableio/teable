import type { IFilter, ISort } from '@teable-group/core';
import {
  ArrowUpDown,
  LayoutList,
  PaintBucket,
  Filter as FilterIcon,
  EyeOff,
} from '@teable-group/icons';
import { Filter, HideFields, RowHeight, useFields, Sort } from '@teable-group/sdk';
import { useView } from '@teable-group/sdk/hooks/use-view';
import { useToast } from '@teable-group/ui-lib';
import { useCallback } from 'react';
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { ToolBarButton } from './ToolBarButton';

export const ViewOperators: React.FC = () => {
  const view = useView();
  const fields = useFields();
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

  const onSortChange = useCallback(
    async (value: ISort | null) => {
      try {
        await view?.setSort?.(value);
      } catch (e) {
        let message;
        if (e instanceof z.ZodError) {
          message = fromZodError(e).message;
        } else {
          message = (e as Error).message;
        }
        toast({
          variant: 'destructive',
          title: 'Uh oh! Something went wrong.',
          description: message,
        });
      }
    },
    [toast, view]
  );

  if (!view || !fields.length) {
    return <div></div>;
  }

  return (
    <div className="flex gap-1">
      <HideFields>
        {(text, isActive) => (
          <ToolBarButton isActive={isActive} text={text} className="max-w-[140px]">
            <EyeOff className="h-4 w-4 text-sm" />
          </ToolBarButton>
        )}
      </HideFields>
      <Filter filters={(view?.filter || null) as IFilter} onChange={onFilterChange}>
        {(text, isActive) => (
          <ToolBarButton isActive={isActive} text={text} className="max-w-[236px]">
            <FilterIcon className="h-4 w-4 text-sm" />
          </ToolBarButton>
        )}
      </Filter>
      <Sort sorts={(view?.sort || null) as ISort} onChange={onSortChange}>
        {(text: string, isActive) => (
          <ToolBarButton isActive={isActive} text={text}>
            <ArrowUpDown className="h-4 w-4 text-sm" />
          </ToolBarButton>
        )}
      </Sort>
      <ToolBarButton text="Group">
        <LayoutList className="h-4 w-4 text-sm" />
      </ToolBarButton>
      <ToolBarButton text="Color">
        <PaintBucket className="h-4 w-4 text-sm" />
      </ToolBarButton>
      <RowHeight>
        {(text, isActive, Icon) => (
          <ToolBarButton isActive={isActive} text={text}>
            <Icon className="text-sm" />
          </ToolBarButton>
        )}
      </RowHeight>
    </div>
  );
};
