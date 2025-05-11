import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DraggableHandle, Star } from '@teable/icons';
import type { IGetPinListVo } from '@teable/openapi';
import { getPinList, updatePinOrder } from '@teable/openapi';
import { LocalStorageKeys, ReactQueryKeys } from '@teable/sdk/config';
import type { DragEndEvent } from '@teable/ui-lib/base';
import { DndKitContext, Draggable, Droppable } from '@teable/ui-lib/base';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useLocalStorage } from 'react-use';
import { spaceConfig } from '@/features/i18n/space.config';
import { PinItem } from './PinItem';
import { StarButton } from './StarButton';

export const PinList = () => {
  const [pinListExpanded, setPinListExpanded] = useLocalStorage<boolean>(
    LocalStorageKeys.PinListExpanded
  );
  const queryClient = useQueryClient();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const { data: pinListData } = useQuery({
    queryKey: ReactQueryKeys.pinList(),
    queryFn: () => getPinList().then((data) => data.data),
  });

  const { mutate: updateOrder } = useMutation({
    mutationFn: updatePinOrder,
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.pinList());
    },
    onError: () => {
      queryClient.invalidateQueries(ReactQueryKeys.pinList());
    },
  });

  const onDragEndHandler = async (event: DragEndEvent) => {
    const { over, active } = event;
    const to = over?.data?.current?.sortable?.index;
    const from = active?.data?.current?.sortable?.index;
    const list = pinListData ?? [];

    if (!over || !list.length || from === to) {
      return;
    }

    const pin = list[from];
    const anchorPin = list[to];
    const position = to > from ? 'after' : 'before';

    updateOrder({
      id: pin.id,
      type: pin.type,
      anchorId: anchorPin.id,
      anchorType: anchorPin.type,
      position,
    });
    queryClient.setQueryData(ReactQueryKeys.pinList(), (prev: IGetPinListVo | undefined) => {
      if (!prev) {
        return [];
      }
      const pre = [...prev];
      pre.splice(from, 1);
      pre.splice(to, 0, pin);
      return pre;
    });
  };

  return (
    <Accordion
      type="single"
      collapsible
      className="w-full shrink-0"
      value={pinListExpanded ? 'pin-list' : ''}
      onValueChange={(value) => {
        setPinListExpanded(value === 'pin-list');
      }}
    >
      <AccordionItem className="border-0" value="pin-list">
        <AccordionTrigger className="px-3 hover:no-underline">
          <div className="flex items-center gap-1">
            <Star className="size-3 fill-yellow-400 text-yellow-400" />
            {t('space:pin.pin')}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="flex max-h-[30vh] flex-col overflow-y-auto px-3">
            {pinListData?.length === 0 && (
              <div className="text-center text-xs text-muted-foreground">
                {t('space:pin.empty')}
              </div>
            )}
            <DndKitContext onDragEnd={onDragEndHandler}>
              <Droppable
                items={pinListData?.map(({ id }) => id) ?? []}
                overlayRender={(active) => {
                  const activePin = pinListData?.find((pin) => pin.id === active?.id);
                  if (!activePin) {
                    return <div />;
                  }
                  return (
                    <div className="flex items-center gap-2 border bg-background">
                      <PinItem
                        className="group"
                        pin={activePin}
                        right={
                          <>
                            <StarButton
                              className="opacity-0 group-hover:opacity-100"
                              id={activePin.id}
                              type={activePin.type}
                            />
                            <DraggableHandle className="opacity-0 group-hover:opacity-100" />
                          </>
                        }
                      />
                    </div>
                  );
                }}
              >
                {pinListData?.map((pin) => (
                  <Draggable key={pin.id} id={pin.id}>
                    {({ setNodeRef, attributes, listeners, style }) => (
                      <div ref={setNodeRef} {...attributes} style={style}>
                        <div className="flex items-center gap-2">
                          <PinItem
                            className="group"
                            pin={pin}
                            right={
                              <>
                                <StarButton
                                  className="opacity-0 group-hover:opacity-100"
                                  id={pin.id}
                                  type={pin.type}
                                />
                                <DraggableHandle
                                  {...listeners}
                                  className="opacity-0 group-hover:opacity-100"
                                />
                              </>
                            }
                          />
                        </div>
                      </div>
                    )}
                  </Draggable>
                ))}
              </Droppable>
            </DndKitContext>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};
