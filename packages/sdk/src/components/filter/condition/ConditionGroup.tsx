import { Trash2, Plus } from '@teable-group/icons';
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
} from '@teable-group/ui-lib';

import classNames from 'classnames';
import { useContext } from 'react';

import { FilterContext } from '../context';
import { isFilterItem, ConditionAddType } from '../types';
import type { IConditionGroupProps } from '../types';
import { Condition } from './Condition';
import { Conjunction } from './Conjunction';

function ConditionGroup(props: IConditionGroupProps) {
  const { index, filter, level, path, conjunction } = props;
  const { filterSet } = filter;
  const context = useContext(FilterContext);
  const { addCondition, deleteCondition, setFilters } = context;

  return (
    <>
      <div className="flex items-start px-1 my-1">
        <Conjunction
          index={index}
          value={conjunction}
          onSelect={(value) => {
            const newPath = [...path];
            newPath.splice(-2, 2, 'conjunction');
            setFilters(newPath, value);
          }}
        ></Conjunction>
        <div
          className={classNames(
            'm-h-20 w-full rounded-sm border ml-2'
            // level > 0 ? 'bg-secondary' : 'bg-secondary/2'
          )}
        >
          <div className="flex justify-between p-1">
            <span className="leading-10 rounded pl-2 text-[13px] text-[#5c5f65]">
              Any of the following are true…
            </span>

            <div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Plus className="h-4 w-4"></Plus>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => {
                      addCondition(path, ConditionAddType.ITEM);
                    }}
                    className="text-[13px]"
                  >
                    <span>Add condition</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => addCondition(path, ConditionAddType.GROUP)}
                    disabled={level > 0}
                    className="text-[13px]"
                  >
                    {!(level > 0) ? (
                      <span className="text-[13px]">Add condition group</span>
                    ) : (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>Add condition group</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Add condition group</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button variant="ghost" onClick={() => deleteCondition(path, index)} size="sm">
                <Trash2 className="h-4 w-4"></Trash2>
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
                />
              ) : (
                <ConditionGroup
                  key={index}
                  index={index}
                  filter={item}
                  level={level + 1}
                  conjunction={filter.conjunction}
                  path={[...path, 'filterSet', index]}
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
