/* eslint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ISelectFieldChoice, IUserCellValue } from '@teable/core';
import { FieldKeyType, FieldType } from '@teable/core';
import { Plus } from '@teable/icons';
import { createRecords } from '@teable/openapi';
import { generateLocalId } from '@teable/sdk/components';
import { useTableId, useViewId } from '@teable/sdk/hooks';
import type { Record } from '@teable/sdk/model';
import { Button, cn } from '@teable/ui-lib';
import { useState } from 'react';
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
  stack: IStackData;
  cards: Record[];
  disabled?: boolean;
  isCollapsed?: boolean;
  setCardMap?: (partialItemMap: ICardMap) => void;
}

export const KanbanStackContainer = (props: IKanbanStackContainerProps) => {
  const { stack, cards, disabled, isCollapsed, setCardMap } = props;
  const tableId = useTableId();
  const viewId = useViewId();
  const { collapsedStackMap, setCollapsedStackMap } = useKanbanStackCollapsedStore();
  const { stackField, setExpandRecordId } = useKanban() as Required<IKanbanContext>;
  const [ref, isInView] = useInView();
  const [editMode, setEditMode] = useState(false);

  const { id: stackId, data: stackData } = stack;
  const { id: fieldId, type: fieldType } = stackField;
  const isUncategorized = stackId === UNCATEGORIZED_STACK_ID;
  const disabledInner = disabled || editMode;

  const {
    attributes,
    isDragging,
    listeners,
    transition,
    transform,
    setNodeRef,
    setDroppableNodeRef,
  } = useSortable({
    id: stackId,
    data: {
      type: 'stack',
    },
    disabled: disabledInner,
  });

  const itemStyle = {
    transition,
    transform: CSS.Translate.toString(transform),
  };

  const onAppend = async () => {
    if (tableId == null) return;
    const cellValue =
      fieldType === FieldType.SingleSelect
        ? (stackData as ISelectFieldChoice).name
        : (stackData as IUserCellValue);
    const res = await createRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: { [fieldId]: cellValue },
        },
      ],
    });
    const record = res.data.records[0];

    if (record != null) {
      setExpandRecordId(record.id);
    }
  };

  const onStackExpand = () => {
    const localId = generateLocalId(tableId, viewId);
    const collapsedStackIdSet = new Set(collapsedStackMap[localId] ?? []);
    collapsedStackIdSet.delete(stackId);
    setCollapsedStackMap(localId, [...collapsedStackIdSet]);
  };

  return (
    <div
      ref={disabledInner ? undefined : isUncategorized ? setDroppableNodeRef : setNodeRef}
      style={itemStyle}
      className={cn(
        'w-[264px] h-full border bg-slate-50 dark:bg-slate-900 rounded-md shrink-0 shadow-md flex flex-col',
        isCollapsed && 'w-14 h-full bg-transparent dark:bg-transparent border-none shadow-none',
        isDragging && 'opacity-50'
      )}
    >
      {isCollapsed ? (
        <div
          className="h-64 w-full cursor-grab rounded-md border bg-slate-50 shadow-md hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800"
          {...attributes}
          {...listeners}
          onClick={onStackExpand}
        >
          <div
            style={{ transform: 'rotate(-90deg) translateX(-100%)' }}
            className="flex h-14 w-64 origin-top-left items-center px-4"
          >
            <KanbanStackTitle stack={stack} isUncategorized={isUncategorized} />
          </div>
        </div>
      ) : (
        <div ref={ref} className="flex size-full flex-col justify-between">
          <div {...attributes} {...listeners} className="w-full">
            <KanbanStackHeader
              stack={stack}
              isUncategorized={isUncategorized}
              setEditMode={setEditMode}
            />
          </div>

          <div className="w-full grow">
            {isInView && <KanbanStack stack={stack} cards={cards} setCardMap={setCardMap} />}
          </div>

          <div className="flex items-center justify-center rounded-b-md bg-slate-50 px-3 py-2 dark:bg-slate-900">
            <Button variant="outline" className="w-full shadow-none" onClick={onAppend}>
              <Plus className="size-5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
