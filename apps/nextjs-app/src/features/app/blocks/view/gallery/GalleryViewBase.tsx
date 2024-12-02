import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCenter,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FieldKeyType } from '@teable/core';
import { useRowCount, useTableId, useViewId } from '@teable/sdk/hooks';
import { Record as RecordModel } from '@teable/sdk/model';
import { cn } from '@teable/ui-lib/shadcn';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from './components/Card';
import { SortableItem } from './components/SortableItem';
import { useGallery, useCacheRecords } from './hooks';
import { calculateColumns, getCardHeight } from './utils';

export const GalleryViewBase = () => {
  const { recordQuery, displayFields, coverField, isFieldNameHidden, permission } = useGallery();
  const tableId = useTableId() as string;
  const viewId = useViewId() as string;
  const rowCount = useRowCount() ?? 0;
  const { cardDraggable } = permission;

  const [activeId, setActiveId] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnsPerRow, setColumnsPerRow] = useState(4);

  const { skip, recordIds, loadedRecordMap, updateSkipIndex, updateRecordOrder } =
    useCacheRecords(recordQuery);

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
    if (!virtualizer.range) return;
    const { startIndex } = virtualizer.range;
    const actualStartIndex = startIndex * columnsPerRow;
    updateSkipIndex(actualStartIndex, rowCount);
  }, [columnsPerRow, rowCount, virtualizer.range, updateSkipIndex]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const activeId = active.id;
    const overId = over?.id;

    if (!activeId || !overId || activeId === overId) return;

    const oldIndex = recordIds.findIndex((id) => id === activeId);
    const newIndex = recordIds.findIndex((id) => id === overId);

    if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;

    const actualOldIndex = oldIndex + skip;
    const actualNewIndex = newIndex + skip;

    updateRecordOrder(actualOldIndex, actualNewIndex);

    RecordModel.updateRecord(tableId, activeId as string, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: {} },
      order: {
        viewId,
        anchorId: overId as string,
        position: actualOldIndex > actualNewIndex ? 'before' : 'after',
      },
    });
  };

  const activeIndex = activeId ? recordIds.findIndex((id) => id === activeId) : null;
  const activeRecord = activeIndex != null ? loadedRecordMap[activeIndex + skip] : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div ref={parentRef} className="size-full overflow-auto p-4">
        <SortableContext items={recordIds} strategy={rectSortingStrategy} disabled={!cardDraggable}>
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
                  const actualIndex = virtualRow.index * columnsPerRow + i;
                  const card = loadedRecordMap[actualIndex];

                  return card ? (
                    <SortableItem key={card.id} id={card.id}>
                      <Card card={card} />
                    </SortableItem>
                  ) : (
                    <div
                      key={`placeholder-${virtualRow.index}-${i}`}
                      className={cn(
                        'flex-1 rounded-md',
                        actualIndex >= rowCount ? 'bg-transparent' : 'bg-muted'
                      )}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </SortableContext>
      </div>
      <DragOverlay>{activeRecord ? <Card card={activeRecord} /> : null}</DragOverlay>
    </DndContext>
  );
};
