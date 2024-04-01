import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { IAttachmentCellValue } from '@teable/core';
import { and, isEmpty, is, FieldType } from '@teable/core';
import type { ISelectChoice } from '@teable/sdk/components';
import { useRecords } from '@teable/sdk/hooks';
import type { Record } from '@teable/sdk/model';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeasure } from 'react-use';
import type { ListOnItemsRenderedProps, VariableSizeList } from 'react-window';
import { VariableSizeList as List } from 'react-window';
import { tableConfig } from '@/features/i18n/table.config';
import { UNCATEGORIZED_STACK_ID } from '../constant';
import type { IKanbanContext } from '../context';
import { useKanban } from '../hooks';
import type { IStackData } from '../type';
import { getCardHeight } from '../utils';
import type { ICardMap } from './interface';
import { KanbanItem } from './KanbanItem';

interface IKanbanStackProps {
  stack: IStackData;
  cards: Record[];
  setCardMap?: (partialItemMap: ICardMap) => void;
}

const LOAD_COUNT = 100;
const TAKE_COUNT = 200;

export const KanbanStack = (props: IKanbanStackProps) => {
  const { stack, cards, setCardMap } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { stackField, displayFields, coverField, isFieldNameHidden } =
    useKanban() as Required<IKanbanContext>;
  const listRef = useRef<VariableSizeList>(null);
  const [skipIndex, setSkipIndex] = useState(0);
  const skipIndexRef = useRef(skipIndex);
  const [ref, { height }] = useMeasure<HTMLDivElement>();

  const cardCount = cards.length;
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

  const cardIds = useMemo(() => {
    return cards.map(({ id }) => id);
  }, [cards]);

  useEffect(() => {
    if (stackCount && !sortedRecords.length) return;
    setCardMap?.({ [stackId]: sortedRecords });
  }, [setCardMap, sortedRecords, stackId, stackCount]);

  const itemData = useMemo(() => {
    return {
      stackId,
      cards,
      skipIndex: skipIndexRef.current,
    };
  }, [cards, stackId]);

  const getItemSize = (index: number) => {
    const card = cards[index - skipIndexRef.current];
    if (card == null) return 160;
    return getCardHeight(
      card,
      displayFields,
      Boolean(
        (card.getCellValue(coverField?.id as string) as IAttachmentCellValue | undefined)?.length
      ),
      isFieldNameHidden
    );
  };

  const onItemsRendered = (props: ListOnItemsRenderedProps) => {
    const { visibleStartIndex } = props;
    const willSkipIndex = Math.max(0, Math.floor(visibleStartIndex / LOAD_COUNT) * LOAD_COUNT);
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

  useEffect(() => {
    listRef.current?.resetAfterIndex(skipIndex, false);
  }, [skipIndex, cardCount, displayFields]);

  return (
    <div ref={ref} className="size-full pt-3">
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        {itemCount ? (
          <List
            ref={listRef}
            height={height}
            width="100%"
            estimatedItemSize={160}
            itemCount={itemCount}
            itemSize={getItemSize}
            itemData={itemData}
            overscanCount={1}
            onItemsRendered={onItemsRendered}
            useIsScrolling
          >
            {KanbanItem}
          </List>
        ) : (
          <div className="flex size-full items-center justify-center text-slate-500">
            {t('table:kanban.stack.noCards')}
          </div>
        )}
      </SortableContext>
    </div>
  );
};
