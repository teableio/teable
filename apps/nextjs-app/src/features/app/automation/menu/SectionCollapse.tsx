import { ChevronRight, DraggableHandle, MoreHorizontal } from '@teable-group/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@teable-group/ui-lib';
import classNames from 'classnames';
import React, { useState } from 'react';
import type { DraggableStateSnapshot, DraggableProvided } from 'react-beautiful-dnd';
import { Droppable, Draggable } from 'react-beautiful-dnd';
import { Card } from './Card';
import { DragCollapse } from './DragCollapse';

interface ISectionCollapseProps {
  cardList: { key: string }[];
  provided: DraggableProvided;
  snapshot: DraggableStateSnapshot;
  id: string;
}

const SectionCollapse = (props: ISectionCollapseProps) => {
  const { cardList = [], snapshot, id } = props;
  const [isHover, setHover] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const triggerRender = (open: boolean) => {
    return (
      <Button
        variant="ghost"
        size="xs"
        className={classNames(
          'group w-full flex h-8 no-user-select',
          snapshot.isDragging ? 'bg-secondary border rounded' : ''
        )}
        onMouseEnter={() => {
          setHover(true);
        }}
        onMouseLeave={() => {
          setHover(false);
        }}
      >
        <ChevronRight
          className={classNames('w-4 h-4 ease-in-out duration-300', open ? 'rotate-90' : '')}
        />
        <span className="text-sm font-semibold flex-1 text-start truncate">Section 1</span>
        <div className="flex items-center">
          {!isHover && !showDropdown && !snapshot.isDragging ? (
            <span className="text-gray-400">{cardList.length} active</span>
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
                    <MoreHorizontal className="w-4 h-4" />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    Duplicate action
                  </DropdownMenuItem>
                  <DropdownMenuItem>delete action</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div>
                <DraggableHandle className="w-4 h-4 cursor-grab" />
              </div>
            </div>
          )}
        </div>
      </Button>
    );
  };

  return (
    <DragCollapse triggerRender={triggerRender} id={id}>
      <Droppable droppableId={id} type="c">
        {(provided) => {
          return (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              {cardList.map(({ key }, index) => (
                <Draggable key={key} draggableId={key} index={index}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className={
                        snapshot.isDragging
                          ? 'bg-secondary outline-2 outline-secondary rounded'
                          : ''
                      }
                    >
                      <Card deploymentStatus={`OFF`} className="hover:bg-secondary" id={key}></Card>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          );
        }}
      </Droppable>
    </DragCollapse>
  );
};

export { SectionCollapse };
