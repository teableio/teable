import { Trash2, Plus } from '@teable/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@teable/ui-lib';

import { useContext } from 'react';

import { useTranslation } from '../../../context/app/i18n';
import { FilterContext } from '../context';
import { isFilterItem, ConditionAddType } from '../types';
import type { IConditionGroupProps } from '../types';
import { Condition } from './Condition';
import { Conjunction } from './Conjunction';

function ConditionGroup(props: IConditionGroupProps) {
  const { index, filter, level, path, conjunction, ...restProp } = props;
  const { filterSet } = filter;
  const context = useContext(FilterContext);
  const { t } = useTranslation();
  const { addCondition, deleteCondition, setFilters } = context;

  return (
    <>
      <div className="my-1 flex items-start px-1">
        <Conjunction
          index={index}
          value={conjunction}
          onSelect={(value) => {
            const newPath = [...path];
            newPath.splice(-2, 2, 'conjunction');
            setFilters(newPath, value);
          }}
        ></Conjunction>
        <div className={cn('m-h-20 flex-1 rounded-sm border ml-2')}>
          <div className="flex items-center justify-between p-1">
            <span className="text-nowrap rounded pl-2 text-[13px] leading-10 text-muted-foreground">
              {t('filter.groupDescription')}
            </span>

            <div className="flex">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Plus className="size-4"></Plus>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => {
                      addCondition(path, ConditionAddType.ITEM);
                    }}
                    className="text-[13px]"
                  >
                    <span>{t('filter.addCondition')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => addCondition(path, ConditionAddType.GROUP)}
                    disabled={level > 0}
                    className="text-[13px]"
                  >
                    {!(level > 0) ? (
                      <span className="text-[13px]">{t('filter.addConditionGroup')}</span>
                    ) : (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>{t('filter.addConditionGroup')}</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t('filter.addConditionGroup')}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button variant="ghost" onClick={() => deleteCondition(path, index)} size="sm">
                <Trash2 className="size-4"></Trash2>
              </Button>
            </div>
          </div>

          <div>
            {filterSet?.map((item, index) =>
              isFilterItem(item) ? (
                <Condition
                  key={index}
                  index={index}
                  filter={item}
                  level={level + 1}
                  conjunction={filter.conjunction}
                  path={[...path, 'filterSet', index]}
                  {...restProp}
                />
              ) : (
                <ConditionGroup
                  key={index}
                  index={index}
                  filter={item}
                  level={level + 1}
                  conjunction={filter.conjunction}
                  path={[...path, 'filterSet', index]}
                  {...restProp}
                />
              )
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export { ConditionGroup };
