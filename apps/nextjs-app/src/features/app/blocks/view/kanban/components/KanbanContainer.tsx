import type {
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DropAnimation,
  UniqueIdentifier,
} from '@dnd-kit/core';
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  MeasuringStrategy,
  defaultDropAnimationSideEffects,
  closestCenter,
  pointerWithin,
  rectIntersection,
  getFirstCollision,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import type { ISelectFieldChoice, IUserCellValue } from '@teable/core';
import { FieldKeyType, FieldType } from '@teable/core';
import type { IUpdateRecordWithOrderRo } from '@teable/openapi';
import { generateLocalId } from '@teable/sdk/components';
import { useTableId, useViewId } from '@teable/sdk/hooks';
import type { SingleSelectField } from '@teable/sdk/model';
import { Record } from '@teable/sdk/model';
import { findIndex, keyBy } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UNCATEGORIZED_STACK_ID } from '../constant';
import type { IKanbanContext } from '../context';
import { useKanban } from '../hooks';
import { useKanbanStackCollapsedStore } from '../store';
import type { ICardMap } from './interface';
import { KanbanCard } from './KanbanCard';
import { KanbanStackContainer } from './KanbanStackContainer';
import { KanbanStackCreator } from './KanbanStackCreator';

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.5',
      },
    },
  }),
};

export interface IKanbanContainerProps {
  field: SingleSelectField;
}

export const KanbanContainer = () => {
  const tableId = useTableId();
  const viewId = useViewId();
  const { collapsedStackMap } = useKanbanStackCollapsedStore();
  const { stackField, stackCollection } = useKanban() as Required<IKanbanContext>;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const [cardMap, setCardMap] = useState<ICardMap>({});
  const [stackIds, setStackIds] = useState(
    stackCollection.map(({ id }) => id) as UniqueIdentifier[]
  );
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [clonedCardMap, setClonedCardMap] = useState<ICardMap | null>(null);
  const lastOverId = useRef<UniqueIdentifier | null>(null);
  const recentlyMovedToNewStack = useRef(false);

  const { id: fieldId, type: fieldType } = stackField;
  const localId = generateLocalId(tableId, viewId);
  const isStackUserField = fieldType === FieldType.User;
  const isSortingCard = Boolean(activeId) && !stackIds.includes(activeId as string);

  const collisionDetectionStrategy: CollisionDetection = useCallback(
    (args) => {
      if (activeId && activeId in cardMap) {
        return closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter(
            (container) => container.id in cardMap
          ),
        });
      }

      const pointerIntersections = pointerWithin(args);
      const intersections =
        pointerIntersections.length > 0 ? pointerIntersections : rectIntersection(args);
      let overId = getFirstCollision(intersections, 'id');

      if (overId != null) {
        if (overId in cardMap) {
          const cards = cardMap[overId];

          if (cards.length > 0) {
            overId = closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter(
                (container) =>
                  container.id !== overId &&
                  cards.findIndex((card) => card.id === (container.id as string)) > -1
              ),
            })[0]?.id;
          }
        }

        lastOverId.current = overId;

        return [{ id: overId }];
      }

      if (recentlyMovedToNewStack.current) {
        lastOverId.current = activeId;
      }

      return lastOverId.current ? [{ id: lastOverId.current }] : [];
    },
    [activeId, cardMap]
  );

  const collapsedStackIdSet = useMemo(() => {
    return new Set(collapsedStackMap[localId] ?? []);
  }, [localId, collapsedStackMap]);

  useEffect(() => {
    setStackIds(stackCollection.map(({ id }) => id) as UniqueIdentifier[]);
  }, [stackCollection]);

  useEffect(() => {
    requestAnimationFrame(() => {
      recentlyMovedToNewStack.current = false;
    });
  }, [cardMap]);

  const stackMap = useMemo(() => keyBy(stackCollection, 'id'), [stackCollection]);

  const setItemMapInner = useCallback((partialCardMap: ICardMap) => {
    setCardMap((prev) => ({ ...prev, ...partialCardMap }));
  }, []);

  const findStackId = (cardMap: ICardMap | null, id: UniqueIdentifier) => {
    if (cardMap == null) return;
    if (id in cardMap) return id;
    return Object.keys(cardMap).find(
      (key) => cardMap[key].findIndex((record) => record.id === id) > -1
    );
  };

  const onDragCancel = () => {
    if (clonedCardMap) {
      setCardMap(clonedCardMap);
    }

    setActiveId(null);
    setClonedCardMap(null);
  };

  const onDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id);
    setClonedCardMap(cardMap);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const activeId = active.id;

    if (over == null || over.id == null) return;

    if (stackIds.includes(activeId)) {
      return;
    }

    const activeStackId = findStackId(cardMap, activeId);

    const { id: overId } = over;
    const overData = over?.data?.current ?? {};
    const { type: overType } = overData;
    const isOverStack = overType === 'stack';
    const overStackId = isOverStack ? overId : overData?.stackId;

    if (!overStackId || !activeStackId) return;

    if (activeStackId !== overStackId) {
      setCardMap((prevCardMap) => {
        const activeCards = prevCardMap[activeStackId];
        const overCards = prevCardMap[overStackId];
        const activeIndex = findIndex(activeCards, { id: activeId as string });
        const overIndex = isOverStack
          ? overCards.length
          : findIndex(overCards, { id: overId as string });

        if (activeIndex === -1 || overIndex === -1) return prevCardMap;

        let newIndex: number;

        if (overId in prevCardMap) {
          newIndex = overCards.length + 1;
        } else {
          const isBelowOverItem =
            over &&
            active.rect.current.translated &&
            active.rect.current.translated.top > over.rect.top + over.rect.height;

          const modifier = isBelowOverItem ? 1 : 0;

          newIndex = overIndex >= 0 ? overIndex + modifier : overCards.length + 1;
        }

        recentlyMovedToNewStack.current = true;

        return {
          ...prevCardMap,
          [activeStackId]: prevCardMap[activeStackId].filter(({ id }) => id !== activeId),
          [overStackId]: [
            ...prevCardMap[overStackId].slice(0, newIndex),
            prevCardMap[activeStackId][activeIndex],
            ...prevCardMap[overStackId].slice(newIndex, prevCardMap[overStackId].length),
          ],
        };
      });
    }
  };

  const onClear = () => {
    setActiveId(null);
    setClonedCardMap(null);
  };

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    const { data: activeData } = active;
    const activeId = active.id as string;
    const overId = over?.id;

    if (stackIds.includes(activeId) && overId) {
      const activeIndex = stackIds.indexOf(activeId);
      const overIndex = stackIds.indexOf(overId);
      const newStackIds = arrayMove(stackIds, activeIndex, overIndex);

      setStackIds(newStackIds);

      if (fieldType === FieldType.SingleSelect) {
        const newChoices = newStackIds
          .map((choiceId) => {
            if (choiceId === UNCATEGORIZED_STACK_ID) return;
            const stack = stackMap[choiceId];
            if (stack == null) return;
            return stack.data;
          })
          .filter(Boolean);
        stackField.convert({
          type: fieldType,
          options: { ...stackField.options, choices: newChoices },
        });
      }
      return onClear();
    }

    const sourceStackId = findStackId(clonedCardMap, activeId);
    const activeStackId = findStackId(cardMap, activeId);

    if (!activeStackId || overId == null) {
      return onClear();
    }

    const overStackId = findStackId(cardMap, overId);

    if (overStackId) {
      const isSameStack = sourceStackId === overStackId;
      const overStackCards = cardMap[overStackId];
      const activeIndex = findIndex(cardMap[activeStackId], { id: activeId as string });
      const overIndex = findIndex(overStackCards, { id: overId as string });

      if (activeIndex === -1 || overIndex === -1) return onClear();

      if (activeIndex !== overIndex) {
        setCardMap({
          ...cardMap,
          [overStackId]: arrayMove(cardMap[overStackId], activeIndex, overIndex),
        });
      }

      const { stackId } = activeData.current ?? {};
      const stack = stackMap[stackId];

      if (tableId == null || viewId == null || stack == null) return onClear();

      if (isSameStack) {
        const currentCard = overStackCards[overIndex];
        if (currentCard) {
          Record.updateRecordOrders(tableId, viewId, {
            anchorId: currentCard.id,
            position: 'before',
            recordIds: [activeId as string],
          });
        }
        return onClear();
      }

      const beforeCard = overStackCards[overIndex - 1];
      const afterCard = overStackCards[overIndex + 1];
      let anchorInfo: Pick<IUpdateRecordWithOrderRo, 'anchorId' | 'position'> | null = null;

      if (beforeCard) {
        anchorInfo = {
          anchorId: beforeCard.id,
          position: 'after',
        };
      } else if (afterCard) {
        anchorInfo = {
          anchorId: afterCard.id,
          position: 'before',
        };
      }

      const isUserField = fieldType === FieldType.User;
      const { id, data } = stack;
      const fieldValue =
        id === UNCATEGORIZED_STACK_ID
          ? null
          : isUserField
            ? (data as IUserCellValue)
            : (data as ISelectFieldChoice).name;

      if (anchorInfo == null) {
        return Record.updateRecord(tableId, activeId, {
          fieldKeyType: FieldKeyType.Id,
          record: {
            fields: {
              [fieldId]: fieldValue,
            },
          },
        });
      }

      Record.updateRecordWithOrder(tableId, viewId, activeId, {
        ...anchorInfo,
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [fieldId]: fieldValue,
          },
        },
      });
    }

    onClear();
  };

  const dragItemOverlay = useMemo(() => {
    if (!activeId) return null;
    if (stackIds.includes(activeId)) {
      const isCollapsed = collapsedStackIdSet.has(activeId as string);
      return (
        <KanbanStackContainer
          stack={stackMap[activeId]}
          cards={cardMap[activeId] ?? []}
          isCollapsed={isCollapsed}
        />
      );
    }
    for (const stackId in cardMap) {
      const cards = cardMap[stackId];
      const card = cards.find((card) => card.id === activeId);
      if (card != null) {
        return (
          <div className="w-full px-3">
            <KanbanCard card={card} />
          </div>
        );
      }
    }
    return null;
  }, [activeId, cardMap, collapsedStackIdSet, stackIds, stackMap]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetectionStrategy}
      measuring={{
        droppable: {
          strategy: MeasuringStrategy.Always,
        },
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex h-full gap-4">
        <SortableContext
          items={stackIds}
          strategy={isSortingCard ? undefined : horizontalListSortingStrategy}
        >
          {stackIds.map((stackId) => {
            const stack = stackMap[stackId];
            if (stack == null) return null;
            const isCollapsed = collapsedStackIdSet.has(stackId as string);
            return (
              <KanbanStackContainer
                key={stackId}
                stack={stack}
                cards={cardMap[stackId] ?? []}
                setCardMap={setItemMapInner}
                disabled={isStackUserField}
                isCollapsed={isCollapsed}
              />
            );
          })}
        </SortableContext>
        {fieldType === FieldType.SingleSelect && (
          <div className="pr-2">
            <KanbanStackCreator />
          </div>
        )}
      </div>
      <DragOverlay adjustScale={false} dropAnimation={dropAnimation}>
        {dragItemOverlay}
      </DragOverlay>
    </DndContext>
  );
};
