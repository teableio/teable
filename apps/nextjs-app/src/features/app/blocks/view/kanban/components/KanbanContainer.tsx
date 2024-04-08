import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import { FieldKeyType, FieldType } from '@teable/core';
import type { IUpdateRecordRo } from '@teable/openapi';
import { generateLocalId } from '@teable/sdk/components';
import { useTableId, useViewId } from '@teable/sdk/hooks';
import { Record } from '@teable/sdk/model';
import { keyBy } from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { UNCATEGORIZED_STACK_ID } from '../constant';
import type { IKanbanContext } from '../context';
import { useKanban } from '../hooks';
import { useKanbanStackCollapsedStore } from '../store';
import { getCellValueByStack, moveTo, reorder } from '../utils';
import type { ICardMap } from './interface';
import { KanbanStackContainer } from './KanbanStackContainer';
import { KanbanStackCreator } from './KanbanStackCreator';

const EMPTY_LIST: never[] = [];

export const KanbanContainer = () => {
  const tableId = useTableId();
  const viewId = useViewId();
  const { collapsedStackMap } = useKanbanStackCollapsedStore();
  const { permission, stackField, stackCollection } = useKanban() as Required<IKanbanContext>;

  const [cardMap, setCardMap] = useState<ICardMap>({});
  const [stackIds, setStackIds] = useState(stackCollection.map(({ id }) => id));

  const localId = generateLocalId(tableId, viewId);
  const { stackCreatable } = permission;
  const { id: fieldId, type: fieldType } = stackField;
  const isUserField = fieldType === FieldType.User;

  const collapsedStackIdSet = useMemo(() => {
    return new Set(collapsedStackMap[localId] ?? []);
  }, [localId, collapsedStackMap]);

  useEffect(() => {
    setStackIds(stackCollection.map(({ id }) => id));
  }, [stackCollection]);

  const stackMap = useMemo(() => keyBy(stackCollection, 'id'), [stackCollection]);

  const setCardMapInner = useCallback((partialCardMap: ICardMap) => {
    setCardMap((prev) => ({ ...prev, ...partialCardMap }));
  }, []);

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const onDragEnd = (result: DropResult) => {
    const { source, destination } = result;

    if (!destination) return;

    const { droppableId: sourceStackId, index: sourceIndex } = source;
    const { droppableId: targetStackId, index: targetIndex } = destination;

    if (sourceStackId === viewId) {
      const newStackIds = reorder(stackIds, sourceIndex, targetIndex);

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
      return;
    }

    if (sourceStackId === targetStackId) {
      const cards = cardMap[sourceStackId];
      const cardCount = cards?.length;

      if (!cardCount) return;

      if (sourceIndex < cardCount && targetIndex < cardCount) {
        if (tableId && viewId) {
          Record.updateRecordOrders(tableId, viewId, {
            anchorId: cards[targetIndex].id,
            position: 'before',
            recordIds: [cards[sourceIndex].id],
          });
        }

        const newCards = reorder(cards, sourceIndex, targetIndex);

        setCardMapInner({ [sourceStackId]: newCards });
      }
      return;
    }

    const sourceCards = cardMap[sourceStackId];
    const targetCards = cardMap[targetStackId];
    const sourceCardId = sourceCards?.[sourceIndex]?.id;
    const targetCardId = targetCards?.[targetIndex]?.id;

    if (tableId && viewId && sourceCardId) {
      const stack = stackCollection.find(({ id }) => id === targetStackId);

      if (stack == null) return;

      const fieldValue = getCellValueByStack(fieldType, stack);

      const recordRo: IUpdateRecordRo = {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [fieldId]: fieldValue,
          },
        },
      };

      if (targetCardId != null) {
        recordRo.order = {
          viewId,
          anchorId: targetCardId,
          position: 'before',
        };
      }

      Record.updateRecord(tableId, sourceCardId, recordRo);
    }

    const { sourceList, targetList } = moveTo({
      source: sourceCards,
      target: targetCards,
      sourceIndex,
      targetIndex,
    });

    setCardMapInner({
      [sourceStackId]: sourceList,
      [targetStackId]: targetList,
    });
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex h-full">
        <Droppable droppableId={viewId!} direction="horizontal" type="column">
          {(provided) => {
            const { droppableProps, placeholder } = provided;

            return (
              <div ref={provided.innerRef} {...droppableProps} className="flex shrink-0">
                {stackIds.map((stackId, index) => {
                  const stack = stackMap[stackId];
                  if (stack == null) return null;
                  const isCollapsed = collapsedStackIdSet.has(stackId as string);
                  return (
                    <KanbanStackContainer
                      key={stackId}
                      index={index}
                      stack={stack}
                      cards={cardMap[stackId] ?? EMPTY_LIST}
                      setCardMap={setCardMapInner}
                      disabled={isUserField}
                      isCollapsed={isCollapsed}
                    />
                  );
                })}
                {placeholder}
              </div>
            );
          }}
        </Droppable>
        {stackCreatable && !isUserField && (
          <div className="pr-2">
            <KanbanStackCreator />
          </div>
        )}
      </div>
    </DragDropContext>
  );
};
