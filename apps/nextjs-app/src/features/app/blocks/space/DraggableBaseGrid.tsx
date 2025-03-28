import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IGetBaseAllVo } from '@teable/openapi';
import { updateBaseOrder } from '@teable/openapi';
import { useIsHydrated } from '@teable/sdk';
import { DndKitContext, Droppable, Draggable } from '@teable/ui-lib/base';
import type { DragEndEvent } from '@teable/ui-lib/base';
import { cn } from '@teable/ui-lib/shadcn';
import { useEffect, useState } from 'react';
import { BaseCard } from './BaseCard';

interface IDraggableBaseGridProps {
  className?: string;
  bases: IGetBaseAllVo;
}

const DraggableBaseGrid = (props: IDraggableBaseGridProps) => {
  const { bases, className } = props;
  const queryClient = useQueryClient();
  const isHydrated = useIsHydrated();
  const [innerBases, setInnerBases] = useState<IGetBaseAllVo>(bases);

  useEffect(() => {
    setInnerBases(bases);
  }, [bases]);

  const { mutateAsync: updateBaseFn } = useMutation({
    mutationFn: updateBaseOrder,
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

    if (!over || !innerBases || from === to) {
      return;
    }

    const list = [...innerBases];
    const [base] = list.splice(from, 1);

    list.splice(to, 0, base);

    setInnerBases(list);

    const baseIndex = list.findIndex((v) => v.id === base.id);

    if (baseIndex == 0) {
      await updateBaseFn({ baseId: base.id, anchorId: list[1].id, position: 'before' });
    } else {
      await updateBaseFn({ baseId: base.id, anchorId: list[baseIndex - 1].id, position: 'after' });
    }
  };

  return isHydrated ? (
    <div
      className={cn(
        'grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3',
        className
      )}
    >
      <DndKitContext onDragEnd={onDragEndHandler}>
        <Droppable items={innerBases.map(({ id }) => id)}>
          {innerBases.map((base) => (
            <Draggable key={base.id} id={base.id}>
              {({ setNodeRef, attributes, listeners, style }) => (
                <div ref={setNodeRef} {...attributes} {...listeners} style={style}>
                  <BaseCard
                    key={base.id}
                    className="h-20 max-w-[34rem] flex-1 sm:min-w-[17rem]"
                    base={base}
                  />
                </div>
              )}
            </Draggable>
          ))}
        </Droppable>
      </DndKitContext>
    </div>
  ) : (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
      {innerBases.map((base) => (
        <div key={base.id}>
          <BaseCard
            key={base.id}
            className="h-20 max-w-[34rem] flex-1 sm:min-w-[17rem]"
            base={base}
          />
        </div>
      ))}
    </div>
  );
};

export { DraggableBaseGrid };
