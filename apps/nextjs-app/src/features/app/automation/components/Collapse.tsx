import { ChevronRight } from '@teable-group/icons';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Button } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useState } from 'react';
// import { Droppable } from 'react-beautiful-dnd';

interface ICollapseProps {
  title?: string;
  children: React.ReactElement;
  triggerRender?: (open: boolean) => React.ReactElement;
  className?: string;
}

const Collapse = (props: ICollapseProps) => {
  const { title, children, triggerRender, className } = props;
  const [open, setOpen] = useState(false);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={classNames('w-full box-border', className)}
    >
      <div className="flex items-center">
        <CollapsibleTrigger asChild>
          {triggerRender?.(open) || (
            <Button variant="ghost" size="xs" className="group w-full flex h-8 justify-between">
              <span className="flex-1 text-left text-sm">{title || 'title'}</span>
              <ChevronRight
                className={classNames('w-4 h-4 ease-in-out duration-300', open ? 'rotate-90' : '')}
              />
            </Button>
          )}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="border-none space-y-2">{children}</CollapsibleContent>
    </Collapsible>
  );
};
export { Collapse };
