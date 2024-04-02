import {
  DndContext,
  MouseSensor,
  useSensor,
  useSensors,
  rectIntersection,
  TouchSensor,
  DragOverlay,
  MeasuringStrategy,
} from '@dnd-kit/core';
import type { DragStartEvent, DragOverEvent } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { Plus } from '@teable/icons';
import {
  cn,
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import { useState } from 'react';
import { AddActionDropMenu } from '../../../../components';
import { Action } from '../Action';
import { ConditionItem } from '../action-group';
import { DraggableContainer } from './DraggableContainer';

const DraggableAction = () => {
  const [actionList, setActionList] = useState(['1', '2']);
  const [logicAction] = useState(['9']);
  const [sonAction, setSonAction] = useState<string[]>([]);

  const [, setDraggingId] = useState<string | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setDraggingId(active?.id as string);
  };
  const handleDragEnd = () => {
    console.log('end');
  };
  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;

    console.log('ggggg', over);

    const activeBelong = actionList.includes(active?.id as string) ? 'top' : 'second';
    const overBelong = over?.id
      ? actionList.includes(over?.id as string)
        ? 'top'
        : 'second'
      : null;

    if (!overBelong) {
      return;
    }

    // top level action drag and group, do nothing
    if (activeBelong === overBelong) {
      return;
    }

    // between action and group
    if (activeBelong !== overBelong) {
      if (activeBelong === 'top') {
        const index = actionList.findIndex((id) => id === active.id);
        const newActionList = [...actionList];
        const item = newActionList.splice(index, 1);
        setActionList(newActionList);

        const newSonList = [...sonAction];
        newSonList.push(...item);
        setSonAction(newSonList);
      } else {
        const index = sonAction.findIndex((id) => id === active.id);
        const newSonList = [...sonAction];
        const item = newSonList.splice(index, 1);
        setSonAction(newSonList);

        const newActions = [...actionList];
        newActions.push(...item);
        setActionList(newActions);
      }
    }

    // between group
  };

  const sensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor));

  return (
    <div className="flex px-2">
      {/* vertical line shaft */}
      <div
        className={cn(
          'before:absolute before:bottom-[17px] before:right-0 before:top-0 before:block before:w-0.5 before:bg-gray-300',
          'relative mr-8 flex w-12 justify-end'
        )}
      >
        <div className="z-10 h-4 bg-secondary text-xs text-gray-400">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs">ACTIONS</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Actions run when the automation is triggered</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* actions */}
      <div>
        <DndContext
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragStart={handleDragStart}
          collisionDetection={rectIntersection}
          sensors={sensors}
          measuring={{
            droppable: {
              strategy: MeasuringStrategy.Always,
            },
          }}
        >
          <SortableContext items={actionList}>
            {actionList.map((id) => (
              <DraggableContainer key={id} id={id}>
                {(ref, handleProps, isDragging) => (
                  <Action
                    id={id}
                    key={id}
                    addable
                    ref={ref}
                    handleProps={handleProps}
                    isDragging={isDragging}
                  ></Action>
                )}
              </DraggableContainer>
            ))}
            <SortableContext items={sonAction}>
              <div className="mt-4">
                {logicAction.map((id, index) => (
                  <div key={id}>
                    <ConditionItem id={id} index={index}>
                      {sonAction?.length ? (
                        sonAction.map((id) => (
                          <DraggableContainer key={id} id={id}>
                            {(ref, handleProps, isDragging) => (
                              <Action
                                id={id}
                                key={id}
                                addable
                                ref={ref}
                                handleProps={handleProps}
                                isDragging={isDragging}
                                statusClassName="-left-10"
                              ></Action>
                            )}
                          </DraggableContainer>
                        ))
                      ) : (
                        <AddActionDropMenu>
                          <div className="mr-1 flex h-16 w-96 cursor-pointer items-center justify-center rounded border-2 border-dashed border-gray-400 hover:opacity-60">
                            Add advanced logic or action
                          </div>
                        </AddActionDropMenu>
                      )}
                    </ConditionItem>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                className="relative w-full rounded-b-lg rounded-t-none border-t-0"
              >
                <Plus />
                Add Condition
                <div className="absolute left-[-34px] top-1/2 h-0.5 w-[34px] bg-slate-300"></div>
              </Button>
            </SortableContext>
          </SortableContext>
          {
            <DragOverlay adjustScale={false}>
              <Action id={'0'} addable></Action>
            </DragOverlay>
          }
        </DndContext>
      </div>
    </div>
  );
};

export { DraggableAction };
