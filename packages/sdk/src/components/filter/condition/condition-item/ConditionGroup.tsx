import { Plus, Trash2 } from '@teable/icons';
import {
  Button,
  DropdownMenu,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib';
import { isValidElement, Children } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import { useCrud, useDepth } from '../../hooks';
import type {
  IComponentWithChildren,
  IBaseFilterComponentProps,
  IBaseConditionProps,
} from '../../types';

interface IConditionGroupProps
  extends IComponentWithChildren,
    Pick<IBaseFilterComponentProps, 'path'>,
    IBaseConditionProps {}

export const ConditionGroup = (props: IConditionGroupProps) => {
  const { children, path, index, depth } = props;
  const maxDepth = useDepth();
  const { onDelete, createCondition } = useCrud();
  const { t } = useTranslation();

  let conditionHeader = (
    <>
      <span className="flex-1 truncate text-xs">{t('filter.groupDescription')}</span>
      <div className="flex gap-1">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger>
            <Button size="xs" variant="ghost" className="size-7">
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={() => {
                createCondition([...path, 'children'], 'item');
              }}
            >
              {t('filter.addCondition')}
            </DropdownMenuItem>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <DropdownMenuItem
                      disabled={depth + 1 > maxDepth}
                      onClick={() => {
                        createCondition([...path, 'children'], 'group');
                      }}
                    >
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
          size="xs"
          variant="ghost"
          onClick={() => {
            onDelete(path, index);
          }}
        >
          <Trash2 />
        </Button>
      </div>
    </>
  );

  let conditionContent;

  Children.forEach(children, (child) => {
    if (isValidElement(child) && typeof child.type === 'function' && child.type.name) {
      if (child.type.name == 'ConditionGroupHeader') {
        conditionHeader = child;
      } else if (child.type.name == 'ConditionGroupContent') {
        conditionContent = child;
      }
    }
  });

  return (
    <div className="flex flex-1 flex-col rounded-sm border border-input px-2 py-1">
      <div className="flex items-center">{conditionHeader}</div>
      <div className="flex flex-col">{conditionContent}</div>
    </div>
  );
};

export const ConditionGroupHeader = ({ children }: IComponentWithChildren) => {
  return children;
};

export const ConditionGroupContent = ({ children }: IComponentWithChildren) => {
  return children;
};

ConditionGroupHeader.displayName = 'ConditionGroupHeader';

ConditionGroupContent.displayName = 'ConditionGroupContent';
