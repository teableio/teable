import type { IConjunction } from '@teable/core';
import { Plus, Trash, ListPlus } from '@teable/icons';
import {
  Button,
  cn,
  DropdownMenu,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib';
import React from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import { useInDrawer } from '../../../adaptive-panel';
import { useCrud, useDepth } from '../../hooks';
import type {
  IComponentWithChildren,
  IBaseFilterComponentProps,
  IBaseConditionProps,
} from '../../types';
import { ConjunctionSelect } from '../ConjunctionSelect';

interface IConditionGroupProps
  extends IComponentWithChildren,
    Pick<IBaseFilterComponentProps, 'path'>,
    IBaseConditionProps {
  conjunction: IConjunction;
}

export const ConditionGroup = (props: IConditionGroupProps) => {
  const { children, path, index, depth, conjunction } = props;
  const maxDepth = useDepth();
  const { onDelete, createCondition, onChange } = useCrud();
  const { t } = useTranslation();
  const inDrawer = useInDrawer();

  const onChangeConjunctionHandler = (val: IConjunction | null) => {
    if (val) {
      onChange([...path, 'conjunction'], val);
    }
  };

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col rounded-lg border border-input px-3 py-2 gap-1.5',
        // Each nesting level eats horizontal room; `min-w-0` keeps the card
        // shrinkable. Drawer padding is tighter to buy back 8px per level.
        inDrawer && 'px-2',
        depth === 1 && 'bg-muted dark:bg-white/5',
        depth === 2 && 'bg-card dark:bg-white/5'
      )}
    >
      <div className={cn('flex min-w-0 items-center', inDrawer && 'gap-1')}>
        <ConjunctionSelect
          value={conjunction}
          onSelect={onChangeConjunctionHandler}
          // Row container: shrinking here is horizontal, which is what keeps
          // the add/delete buttons on screen when the label is long. Field
          // setting sheets are ~400px and are not InDrawer (T7084).
          className="min-w-0 shrink"
        />
        <div className="ms-auto flex shrink-0">
          {/* Must match the surrounding layer: a non-modal menu inside a
              modal drawer dismisses the wrong DismissableLayer. */}
          <DropdownMenu modal={inDrawer}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                data-testid="filter-group-add"
              >
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => {
                  createCondition([...path, 'children'], 'item');
                }}
              >
                <Plus className="me-2 size-4" />
                {t('filter.addCondition')}
              </DropdownMenuItem>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <DropdownMenuItem
                        className="cursor-pointer"
                        disabled={depth + 1 > maxDepth}
                        onClick={() => {
                          createCondition([...path, 'children'], 'group');
                        }}
                      >
                        <ListPlus className="me-2 size-4" />
                        {t('filter.addConditionGroup')}
                      </DropdownMenuItem>
                    </div>
                  </TooltipTrigger>
                  {depth + 1 > maxDepth && (
                    <TooltipContent hideWhenDetached={true}>
                      <span>{t('filter.nestedLimitTip', { depth: maxDepth + 1 })}</span>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size={'icon'}
            className="size-8 text-muted-foreground"
            onClick={() => {
              onDelete(path, index);
            }}
          >
            <Trash className="size-4" />
          </Button>
        </div>
      </div>
      {React.Children.count(children) > 0 && (
        <div className="mb-1 flex flex-col gap-3">{children}</div>
      )}
    </div>
  );
};

export const ConditionGroupContent = ({ children }: IComponentWithChildren) => {
  return children;
};

ConditionGroupContent.displayName = 'ConditionGroupContent';
