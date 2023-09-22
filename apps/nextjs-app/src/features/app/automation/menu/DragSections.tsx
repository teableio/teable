import { useIsHydrated } from '@teable-group/sdk/hooks';
import type { OnDragEndResponder } from 'react-beautiful-dnd';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { SectionCollapse } from '.';

const DragSections = () => {
  const isHydrated = useIsHydrated();
  const onDragEnd: OnDragEndResponder = (result) => {
    if (!result.destination) return;

    // const {
    //   source: { index: from },
    //   destination: { index: to },
    // } = result;

    console.warn('onDragEnd', result);
  };
  const list = [
    {
      key: '1',
      list: [{ key: '1-1' }],
    },
    {
      key: '2',
      list: [{ key: '2-1' }],
    },
    {
      key: '3',
      list: [{ key: '3-1' }],
    },
    {
      key: '4',
      list: [{ key: '4-1' }, { key: '4-2' }],
    },
  ];
  return (
    <DragDropContext onDragEnd={onDragEnd}>
      {isHydrated && (
        <Droppable droppableId="board" direction="vertical" type="l">
          {(provided) => {
            return (
              <div {...provided.droppableProps} ref={provided.innerRef}>
                {list.map((item, index) => (
                  <Draggable key={item.key} draggableId={item.key} index={index}>
                    {(provided, _snapshot) => {
                      return (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                        >
                          <SectionCollapse
                            cardList={item.list}
                            key={item.key}
                            id={item.key}
                            provided={provided}
                            snapshot={_snapshot}
                          ></SectionCollapse>
                        </div>
                      );
                    }}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            );
          }}
        </Droppable>
      )}
    </DragDropContext>
  );
};

export { DragSections };
