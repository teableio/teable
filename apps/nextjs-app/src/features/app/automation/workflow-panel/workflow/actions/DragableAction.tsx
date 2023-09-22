import { useIsHydrated } from '@teable-group/sdk';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable-group/ui-lib';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { Action } from './Action';

interface IActionsProps {
  actionList?: [];
}

// todo add draggable
const DragableAction = (props: IActionsProps) => {
  const { actionList = ['1', '2', '3', '4', '5', '6'] } = props;
  const isHydrated = useIsHydrated();
  const onDragEnd = () => {
    console.log('1');
  };

  return (
    <div className="flex px-2">
      <div className="w-12 mr-4 flex relative before:block before:absolute before:w-0.5 before:h-full before:bg-gray-300 before:right-0 before:top-0 justify-end">
        <div className="bg-secondary text-xs text-gray-400 h-4 z-10">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs">ACTIONS</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Actions run when the automation is triggered</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <div>
        <DragDropContext onDragEnd={onDragEnd}>
          {isHydrated && (
            <Droppable droppableId="droppable">
              {(provided) => (
                <ul
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  style={{ listStyle: 'none', padding: 0, height: 'auto' }}
                >
                  {actionList?.map((action, index) => (
                    <Draggable key={action} draggableId={action} index={index}>
                      {(provided) => (
                        <li
                          ref={provided.innerRef}
                          {...provided.dragHandleProps}
                          {...provided.draggableProps}
                        >
                          <Action key={index} addable id={action}></Action>
                        </li>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </ul>
              )}
            </Droppable>
          )}
        </DragDropContext>
      </div>
    </div>
  );
};

export { DragableAction };
