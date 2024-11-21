/* eslint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */
import { Draggable } from '@hello-pangea/dnd';
import { Plus } from '@teable/icons';
import { CreateRecordModal, generateLocalId } from '@teable/sdk/components';
import { useTableId, useViewId } from '@teable/sdk/hooks';
import type { Record } from '@teable/sdk/model';
import { Button, cn } from '@teable/ui-lib';
import { useRef, useState } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { UNCATEGORIZED_STACK_ID } from '../constant';
import type { IKanbanContext } from '../context';
import { useInView, useKanban } from '../hooks';
import { useKanbanStackCollapsedStore } from '../store';
import type { IStackData } from '../type';
import type { ICardMap } from './interface';
import { KanbanStack } from './KanbanStack';
import { KanbanStackHeader } from './KanbanStackHeader';
import { KanbanStackTitle } from './KanbanStackTitle';

interface IKanbanStackContainerProps {
  index: number;
  stack: IStackData;
  cards: Record[];
  disabled?: boolean;
  isCollapsed?: boolean;
  setCardMap?: (partialItemMap: ICardMap) => void;
}

export const KanbanStackContainer = (props: IKanbanStackContainerProps) => {
  const { index, stack, cards, disabled, isCollapsed, setCardMap } = props;
  const tableId = useTableId();
  const viewId = useViewId();
  const { collapsedStackMap, setCollapsedStackMap } = useKanbanStackCollapsedStore();
  const { permission } = useKanban() as Required<IKanbanContext>;
  const [ref, isInView] = useInView();
  const [editMode, setEditMode] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const { id: stackId } = stack;
  const { stackDraggable, cardCreatable } = permission;
  const isUncategorized = stackId === UNCATEGORIZED_STACK_ID;
  const draggable = stackDraggable && !disabled && !editMode && !isUncategorized;

  const onAppendCallback = () => {
    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: 'LAST',
      });
    }, 500);
  };

  const onStackExpand = () => {
    const localId = generateLocalId(tableId, viewId);
    const collapsedStackIdSet = new Set(collapsedStackMap[localId] ?? []);
    collapsedStackIdSet.delete(stackId);
    setCollapsedStackMap(localId, [...collapsedStackIdSet]);
  };

  return (
    <Draggable draggableId={stackId} index={index} key={stackId} isDragDisabled={!draggable}>
      {(provided, snapshot) => {
        const { draggableProps, dragHandleProps } = provided;
        const { isDragging } = snapshot;

        return (
          <div className="h-full pr-4" ref={provided.innerRef} {...draggableProps}>
            {isCollapsed ? (
              <div className="h-full w-14">
                <div
                  className={cn(
                    'h-64 w-full cursor-grab rounded-md border bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800',
                    isDragging && 'shadow-md'
                  )}
                  {...dragHandleProps}
                  onClick={onStackExpand}
                >
                  <div
                    style={{ transform: 'rotate(-90deg) translateX(-100%)' }}
                    className="flex h-14 w-64 origin-top-left items-center px-4"
                  >
                    <KanbanStackTitle stack={stack} isUncategorized={isUncategorized} />
                  </div>
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  'w-[264px] h-full border bg-slate-50 dark:bg-muted rounded-md shrink-0 flex flex-col',
                  isDragging && 'shadow-md'
                )}
              >
                <div ref={ref} className="flex size-full flex-col justify-between">
                  <div {...dragHandleProps} className="w-full">
                    <KanbanStackHeader
                      stack={stack}
                      isUncategorized={isUncategorized}
                      setEditMode={setEditMode}
                    />
                  </div>

                  <div className="w-full grow">
                    {isInView && (
                      <KanbanStack
                        ref={virtuosoRef}
                        stack={stack}
                        cards={cards}
                        setCardMap={setCardMap}
                      />
                    )}
                  </div>

                  {cardCreatable && (
                    <CreateRecordModal callback={onAppendCallback}>
                      <div className="flex items-center justify-center rounded-b-md bg-slate-50 px-3 py-2 dark:bg-muted">
                        <Button variant="outline" className="w-full shadow-none hover:bg-zinc-700">
                          <Plus className="size-5" />
                        </Button>
                      </div>
                    </CreateRecordModal>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      }}
    </Draggable>
  );
};
