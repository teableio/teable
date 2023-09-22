import { ChevronRight } from '@teable-group/icons';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Button } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useState } from 'react';
import { Droppable } from 'react-beautiful-dnd';

interface ICollapseProps {
  title?: string;
  children: React.ReactElement;
  triggerRender?: (open: boolean) => React.ReactElement;
  className?: string;
  id: string;
}

const DragCollapse = (props: ICollapseProps) => {
  const { title, children, triggerRender, id } = props;
  const [open, setOpen] = useState(false);

  return (
    <Droppable droppableId={id} type="c">
      {(provided, snapshot) => {
        return (
          <div {...provided.droppableProps} ref={provided.innerRef}>
            <Collapsible
              open={open}
              onOpenChange={setOpen}
              className={classNames(
                'w-full space-y-2 box-border',
                snapshot.isDraggingOver ? 'border outline-2 outline-secondary rounded' : ''
              )}
            >
              <div className="flex items-center">
                <CollapsibleTrigger asChild>
                  {triggerRender?.(open) || (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="group w-full flex h-8 justify-between"
                    >
                      <ChevronRight
                        className={classNames(
                          'w-4 h-4 ease-in-out duration-300',
                          open ? 'rotate-90' : ''
                        )}
                      />
                      <span className="flex-1 text-left text-sm">{title || 'title'}</span>
                    </Button>
                  )}
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className="space-y-2 border-none">{children}</CollapsibleContent>

              <div
                className={classNames(
                  'transition-all ease-in-out delay-150s',
                  snapshot.isDraggingOver && !open ? 'h-16' : 'h-0'
                )}
              ></div>
              <div hidden>{provided.placeholder}</div>
            </Collapsible>
          </div>
        );
      }}
    </Droppable>
  );
};
export { DragCollapse };
