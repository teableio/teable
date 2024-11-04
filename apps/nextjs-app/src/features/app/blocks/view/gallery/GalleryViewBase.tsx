import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCenter,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FieldKeyType } from '@teable/core';
import { useRecords, useRowCount, useTableId, useViewId } from '@teable/sdk/hooks';
import { Record } from '@teable/sdk/model';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from './components/Card';
import { SortableItem } from './components/SortableItem';
import { useGallery } from './hooks';
import { calculateColumns, getCardHeight } from './utils';

const DEFAULT_TAKE = 200;

export const GalleryViewBase = () => {
  const { recordQuery, displayFields, coverField, isFieldNameHidden } = useGallery();
  const tableId = useTableId() as string;
  const viewId = useViewId() as string;
  const rowCount = useRowCount() ?? 0;

  const [skip, setSkip] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const skipIndexRef = useRef(skip);
  const [columnsPerRow, setColumnsPerRow] = useState(4);

  const query = useMemo(() => {
    return {
      ...recordQuery,
      skip,
      take: DEFAULT_TAKE,
    };
  }, [recordQuery, skip]);

  const { records } = useRecords(query);

  const [cards, setCards] = useState<Record[]>(records);

  const virtualizer = useVirtualizer({
    count: Math.ceil(rowCount / columnsPerRow),
    getScrollElement: () => parentRef.current,
    estimateSize: () => getCardHeight(displayFields, Boolean(coverField), isFieldNameHidden),
    overscan: 5,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const updateGridColumns = useCallback(() => {
    if (!parentRef.current) return;
    const containerWidth = parentRef.current.offsetWidth;
    setColumnsPerRow(calculateColumns(containerWidth));
  }, []);

  useEffect(() => {
    virtualizer.measure();
  }, [displayFields, coverField, isFieldNameHidden, virtualizer]);

  useEffect(() => {
    const container = parentRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      updateGridColumns();
    });

    resizeObserver.observe(container);
    updateGridColumns();

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateGridColumns]);

  useEffect(() => {
    if (!records.length) return;

    setCards((prev) => {
      const merged = [...prev];
      records.forEach((record, index) => {
        merged[skipIndexRef.current + index] = record;
      });
      return merged;
    });
  }, [records]);

  useEffect(() => {
    if (!virtualizer.range) return;
    const { endIndex } = virtualizer.range;
    const actualIndex = endIndex * columnsPerRow;
    const newSkip = Math.floor(actualIndex / DEFAULT_TAKE) * DEFAULT_TAKE;

    if (newSkip >= rowCount) return;

    skipIndexRef.current = newSkip;
    setSkip(newSkip);
  }, [columnsPerRow, rowCount, virtualizer.range]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = cards.findIndex((item) => item.id === active.id);
      const newIndex = cards.findIndex((item) => item.id === over?.id);
      const newCards = arrayMove(cards, oldIndex, newIndex);

      setCards(newCards);

      if (oldIndex != null && newIndex != null && oldIndex !== newIndex) {
        Record.updateRecord(tableId, active.id as string, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: {} },
          order: {
            viewId,
            anchorId: over?.id as string,
            position: oldIndex > newIndex ? 'before' : 'after',
          },
        });
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div ref={parentRef} className="size-full overflow-auto p-4">
        <SortableContext items={cards} strategy={rectSortingStrategy}>
          <div
            className="relative w-full"
            style={{
              height: `${virtualizer.getTotalSize()}px`,
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.index}
                className="absolute left-0 top-0 flex w-full gap-x-4 pb-4"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {Array.from({ length: columnsPerRow }).map((_, i) => {
                  const card = cards[virtualRow.index * columnsPerRow + i];
                  return card ? (
                    <SortableItem key={card.id} id={card.id}>
                      <Card card={card} />
                    </SortableItem>
                  ) : (
                    <div
                      key={`placeholder-${virtualRow.index}-${i}`}
                      className="flex-1 bg-background"
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </SortableContext>
      </div>
      <DragOverlay>
        {activeId ? <Card card={cards.find((c) => c?.id === activeId)!} /> : null}
      </DragOverlay>
    </DndContext>
  );
};
