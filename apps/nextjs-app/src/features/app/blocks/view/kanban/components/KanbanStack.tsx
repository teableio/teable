/* eslint-disable @typescript-eslint/ban-ts-comment */
import { and, isEmpty, is, FieldType } from '@teable/core';
import type { ISelectChoice } from '@teable/sdk/components';
import { useRecords } from '@teable/sdk/hooks';
import type { Record } from '@teable/sdk/model';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { Draggable, Droppable } from 'react-beautiful-dnd';
import { useTranslation } from 'react-i18next';
import { useMeasure } from 'react-use';
import type { ListRange, VirtuosoHandle } from 'react-virtuoso';
import { Virtuoso } from 'react-virtuoso';
import { tableConfig } from '@/features/i18n/table.config';
import { UNCATEGORIZED_STACK_ID } from '../constant';
import type { IKanbanContext } from '../context';
import { useKanban } from '../hooks';
import type { IStackData } from '../type';
import type { ICardMap } from './interface';
import { KanbanCard } from './KanbanCard';

interface IKanbanStackProps {
  stack: IStackData;
  cards: Record[];
  setCardMap?: (partialItemMap: ICardMap) => void;
}

const LOAD_COUNT = 100;
const TAKE_COUNT = 200;

// @ts-ignore
const HeightPreservingItem = ({ children, ...props }) => {
  const [size, setSize] = useState(0);
  const knownSize = props['data-known-size'];

  useEffect(() => {
    setSize((prevSize) => {
      return knownSize == 0 ? prevSize : knownSize;
    });
  }, [knownSize]);

  return (
    <div
      {...props}
      className="height-preserving-container"
      style={{
        // @ts-ignore
        '--child-height': `${size}px`,
      }}
    >
      {children}
    </div>
  );
};

export const KanbanStack = forwardRef<VirtuosoHandle, IKanbanStackProps>((props, forwardRef) => {
  const { stack, cards, setCardMap } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { stackField, permission } = useKanban() as Required<IKanbanContext>;
  const [skipIndex, setSkipIndex] = useState(0);
  const skipIndexRef = useRef(skipIndex);
  const [ref, { height }] = useMeasure<HTMLDivElement>();

  const cardCount = cards.length;
  const { cardDraggable } = permission;
  const { id: fieldId, type: fieldType } = stackField;
  const { id: stackId, data: stackData, count: stackCount } = stack;
  const isUncategorized = stackId === UNCATEGORIZED_STACK_ID;
  const filterValue = fieldType === FieldType.User ? stackId : (stackData as ISelectChoice).name;

  const query = useMemo(() => {
    return {
      skip: skipIndex,
      take: TAKE_COUNT,
      filter: {
        conjunction: and.value,
        filterSet: [
          {
            fieldId,
            operator: isUncategorized ? isEmpty.value : is.value,
            value: (isUncategorized ? null : filterValue) as string | null,
          },
        ],
      },
    };
  }, [fieldId, isUncategorized, skipIndex, filterValue]);

  const records = useRecords(query);

  const sortedRecords = useMemo(() => {
    return records.filter(Boolean);
  }, [records]);

  useEffect(() => {
    if (stackCount && !sortedRecords.length) return;
    setCardMap?.({ [stackId]: sortedRecords });
  }, [setCardMap, sortedRecords, stackId, stackCount]);

  const onRangeChanged = (range: ListRange) => {
    const { startIndex } = range;
    const willSkipIndex = Math.max(0, Math.floor(startIndex / LOAD_COUNT) * LOAD_COUNT);
    if (willSkipIndex !== skipIndex) {
      setSkipIndex(willSkipIndex);
      skipIndexRef.current = willSkipIndex;
    }
  };

  const itemCount = useMemo(() => {
    if (stackCount == null) return 0;
    if (cardCount > stackCount) return cardCount;
    if (cardCount > TAKE_COUNT) return stackCount + 1;
    return stackCount;
  }, [cardCount, stackCount]);

  return (
    <div ref={ref} className="size-full pt-3">
      <Droppable
        droppableId={stackId}
        mode="virtual"
        renderClone={(provided, snapshot, rubric) => {
          const card = cards[rubric.source.index];
          const { isDragging } = snapshot;
          return (
            <KanbanCard provided={provided} card={card} stack={stack} isDragging={isDragging} />
          );
        }}
      >
        {(provided, _snapshot) => (
          <>
            {cardCount ? (
              <Virtuoso
                ref={forwardRef}
                scrollerRef={provided.innerRef as never}
                components={{
                  Item: HeightPreservingItem as never,
                }}
                style={{ width: '100%', height }}
                totalCount={itemCount}
                itemContent={(index) => {
                  const realIndex = index - skipIndex;
                  const card = cards[realIndex];
                  if (card == null) {
                    return <div className="h-32 w-full" />;
                  }
                  return (
                    <Draggable
                      draggableId={card.id}
                      index={realIndex}
                      key={card.id}
                      isDragDisabled={!cardDraggable}
                    >
                      {(provided) => <KanbanCard provided={provided} card={card} stack={stack} />}
                    </Draggable>
                  );
                }}
                rangeChanged={onRangeChanged}
              />
            ) : (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="flex size-full items-center justify-center text-slate-500"
              >
                {t('table:kanban.stack.noCards')}
              </div>
            )}
          </>
        )}
      </Droppable>
    </div>
  );
});

KanbanStack.displayName = 'KanbanStack';
