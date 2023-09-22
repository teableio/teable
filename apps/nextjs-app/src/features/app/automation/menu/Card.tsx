import { DraggableHandle, MoreHorizontal } from '@teable-group/icons';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Badge,
  AvatarImage,
  AvatarFallback,
  Avatar,
} from '@teable-group/ui-lib';
import classNames from 'classnames';
import Link from 'next/link';
import { useState } from 'react';

export interface ICardProps {
  className?: string;
  description?: string;
  title?: string;
  deploymentStatus: 'OFF' | 'ON';
  actionType?: string;
  id: string;
}

const Card = (props: ICardProps) => {
  const {
    className,
    title = 'title',
    description = 'description',
    deploymentStatus = 'OFF',
    id,
  } = props;
  const [isHover, setHover] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <Link
      href={{
        pathname: '/space/automation/[automationId]',
        query: { automationId: id },
      }}
      shallow={true}
    >
      <section
        className={classNames('flex items-center p-2 rounded cursor-pointer', className)}
        onMouseEnter={() => {
          setHover(true);
        }}
        onMouseLeave={() => {
          setHover(false);
        }}
      >
        {/* <div className="w-12 h-12 shrink-0"></div> */}
        <Avatar>
          <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
          <AvatarFallback>CN</AvatarFallback>
        </Avatar>
        <div className="flex flex-1 justify-between items-center">
          <div className="flex flex-col w-max text-sm pl-2">
            <span>{title}</span>
            <span>{description}</span>
          </div>
          <div className="flex items-center">
            {!isHover && !showDropdown ? (
              <Badge
                variant={deploymentStatus === 'OFF' ? 'destructive' : 'secondary'}
                className={classNames('p-1', deploymentStatus === 'ON' ? 'bg-green-700' : '')}
              >
                {deploymentStatus}
              </Badge>
            ) : (
              <>
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
                    <DropdownMenuItem>Rename</DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem>Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DraggableHandle className="w-4 h-4 cursor-grab" />
              </>
            )}
          </div>
        </div>
      </section>
    </Link>
  );
};

export { Card };
