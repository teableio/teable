import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IGetBaseVo } from '@teable/openapi';
import { updateBase } from '@teable/openapi';
import { swapReorder, useIsHydrated } from '@teable/sdk';
import { DndKitContext, Droppable, Draggable } from '@teable/ui-lib/base';
import type { DragEndEvent } from '@teable/ui-lib/base';
import { useEffect, useState } from 'react';
import { BaseCard } from './BaseCard';

interface IDraggableBaseGridProps {
  bases: IGetBaseVo[];
}

const DraggableBaseGrid = (props: IDraggableBaseGridProps) => {
  const { bases } = props;
  const queryClient = useQueryClient();
  const isHydrated = useIsHydrated();
  const [innerBases, setInnerBases] = useState<IGetBaseVo[]>([]);

  useEffect(() => {
    if (!bases?.length) {
      return;
    }
    const newBases = bases.sort((a, b) => a.order - b.order);
    setInnerBases(newBases);
  }, [bases]);

  const { mutateAsync: updateBaseFn } = useMutation({
    mutationFn: updateBase,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['base-list'],
      });
    },
  });

  const onDragEndHandler = async (event: DragEndEvent) => {
    const { over, active } = event;
    const to = over?.data?.current?.sortable?.index;
    const from = active?.data?.current?.sortable?.index;

    if (!over || !innerBases) {
      return;
    }

    const list = [...innerBases];
    const [base] = list.splice(from, 1);

    const newOrder = swapReorder(1, from, to, innerBases.length, (index: number) => {
      return innerBases[index].order;
    })[0];

    if (newOrder === base.order) {
      return;
    }
    list.splice(to, 0, base);

    setInnerBases(list);
    updateBaseFn({ baseId: base.id, updateBaseRo: { order: newOrder } });
  };

  return (
    isHydrated && (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
        <DndKitContext onDragEnd={onDragEndHandler}>
          <Droppable items={innerBases.map(({ id }) => id)}>
            {innerBases.map((base) => (
              <Draggable key={base.id} id={base.id}>
                {({ setNodeRef, attributes, listeners, style }) => (
                  <div ref={setNodeRef} {...attributes} {...listeners} style={style}>
                    <BaseCard
                      key={base.id}
                      className="h-24 min-w-[17rem] max-w-[34rem] flex-1"
                      base={base}
                    />
                  </div>
                )}
              </Draggable>
            ))}
          </Droppable>
        </DndKitContext>
      </div>
    )
  );
};

export { DraggableBaseGrid };
