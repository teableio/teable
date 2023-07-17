import Add from '@teable-group/ui-lib/icons/app/add.svg';
import AshBin from '@teable-group/ui-lib/icons/app/ashbin.svg';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable-group/ui-lib/shadcn/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable-group/ui-lib/shadcn/ui/tooltip';
import { cloneDeep } from 'lodash';
import { useContext } from 'react';
import { cn } from '@/lib/utils';
import { FilterContext } from '../context';
import { isFilterMeta } from '../types';
import type { IConditionGroupProps } from '../types';
import { Condition } from './Condition';
import { Conjunction } from './Conjunction';

function ConditionGroup(props: IConditionGroupProps) {
  const { index, filter, parent, level } = props;

  const context = useContext(FilterContext);
  if (!context) {
    return null;
  }
  const { setFilters, filters, addCondition, addConditionGroup } = context;

  const deleteItem = () => {
    parent.filterSet.splice(index, 1);
    const newFilters = cloneDeep(filters);
    setFilters(newFilters);
  };

  return (
    <>
      <div className="flex items-start p-1">
        <Conjunction
          index={index}
          parent={parent}
          filters={filters}
          setFilter={setFilters}
        ></Conjunction>
        <div
          className={cn(
            'm-h-20 w-full rounded-sm border m-1'
            // level > 0 ? 'bg-ring' : 'bg-secondary'
          )}
        >
          <div className="flex justify-between p-1">
            <span className="leading-10 rounded pl-2 text-[13px] text-[#5c5f65]">
              Any of the following are true…
            </span>

            <div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost">
                    <Add className="h-4 w-4"></Add>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => addCondition(filter)}>
                    Add condition
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => addConditionGroup(filter)} disabled={level > 0}>
                    {!(level > 0) ? (
                      'Add condition group'
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

              <Button variant="ghost" onClick={deleteItem}>
                <AshBin className="h-4 w-4"></AshBin>
              </Button>
            </div>
          </div>

          <div>
            {filter?.filterSet?.map((item, index) =>
              isFilterMeta(item) ? (
                <Condition key={index} index={index} filter={item} parent={filter} />
              ) : (
                <ConditionGroup
                  key={index}
                  index={index}
                  filter={item}
                  parent={filter}
                  level={level + 1}
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
