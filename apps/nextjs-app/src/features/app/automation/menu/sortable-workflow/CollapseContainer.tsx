import type { IWorkflow } from '@teable-group/core';
import { DraggableHandle, ChevronRight, MoreHorizontal } from '@teable-group/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@teable-group/ui-lib';
import { useLocalStorage } from '@uidotdev/usehooks';
import classNames from 'classnames';
import React, { useState, forwardRef, useEffect } from 'react';

interface ICollapseContainerProps {
  children: React.ReactElement;
  hover: boolean;
  style?: React.CSSProperties;
  name: string;
  className?: string;

  id: string;
  handleProps: React.HTMLAttributes<HTMLDivElement>;
  workflow: IWorkflow;
  isDragging: boolean;
}

const CollapseContainer = forwardRef<HTMLDivElement, ICollapseContainerProps>((props, ref) => {
  const { id, children, style, handleProps, name, workflow, className, isDragging } = props;
  const [collapseIds, setCollapseIds] = useLocalStorage<string[]>('workflowsListStates', []);
  const [open, setOpen] = useState(collapseIds?.includes(name) ?? true);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isHover, setHover] = useState(false);

  useEffect(() => {
    const IdSet = new Set(collapseIds);
    if (open && !IdSet.has(id)) {
      IdSet.add(id);
      setCollapseIds([...IdSet]);
    }
    if (!open && IdSet.has(id)) {
      IdSet.delete(id);
      setCollapseIds([...IdSet]);
    }
  }, [collapseIds, id, open, setCollapseIds]);

  return (
    <div style={{ ...style }} className={className} ref={ref}>
      <Button
        variant="ghost"
        onClick={() => {
          setOpen(!open);
        }}
        onMouseEnter={() => {
          setHover(true);
        }}
        onMouseLeave={() => {
          setHover(false);
        }}
        className={classNames('w-full flex justify-between px-2')}
      >
        <ChevronRight
          className={classNames('w-4 h-4 ease-in-out duration-300', open ? 'rotate-90' : '')}
        />
        <span className="flex-1 truncate text-start text-sm font-semibold">{name}</span>
        <div className="flex items-center">
          {!isHover && !showDropdown && !isDragging ? (
            <span className="text-gray-400">{workflow.length} active</span>
          ) : (
            <div className="flex">
              <DropdownMenu
                open={showDropdown}
                onOpenChange={(open) => {
                  if (!open) {
                    setHover(false);
                  }
                  setShowDropdown(open);
                }}
              >
                <DropdownMenuTrigger asChild>
                  <div className="text-slate-400">
                    <MoreHorizontal className="h-4 w-4" />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    Rename section
                  </DropdownMenuItem>
                  <DropdownMenuItem>Delete section</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div {...handleProps}>
                <DraggableHandle className="h-4 w-4 cursor-grab" />
              </div>
            </div>
          )}
        </div>
      </Button>
      {isDragging ? null : children}
    </div>
  );
});

CollapseContainer.displayName = 'CollapseContainer';

export { CollapseContainer };
