import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DeploymentStatus } from '@teable/core';
import { DraggableHandle, MoreHorizontal } from '@teable/icons';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Badge,
  AvatarImage,
  AvatarFallback,
  Avatar,
  cn,
} from '@teable/ui-lib';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';

export interface IWorkflowCardProps {
  className?: string;
  description?: string | null;
  name?: string;
  deploymentStatus: DeploymentStatus;
  id: string;
}

const WorkflowCard = (props: IWorkflowCardProps) => {
  const {
    className,
    name = 'title',
    description = 'no description',
    deploymentStatus = 'Deployed',
    id,
  } = props;

  const sortProps = useSortable({
    id: id,
  });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortProps;
  const mergedTransform = transform ? { ...transform, scaleX: 1, scaleY: 1 } : null;
  const styles = {
    transform: CSS.Transform.toString(mergedTransform),
    transition,
  };

  const [isHover, setHover] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const router = useRouter();
  const {
    query: { baseId, automationId },
  } = router;
  const isActive = useMemo(() => id === automationId, [id, automationId]);

  return (
    <Link
      href={{
        pathname: '/base/[baseId]/automation/[automationId]',
        query: { baseId: baseId, automationId: id },
      }}
      shallow={true}
    >
      <section
        className={cn(
          'flex items-center p-2 rounded cursor-pointer hover:bg-secondary m-1 box-border',
          className,
          isActive ? 'bg-sky-200' : null
        )}
        style={styles}
        ref={setNodeRef}
        onMouseEnter={() => {
          setHover(true);
        }}
        onMouseLeave={() => {
          setHover(false);
        }}
      >
        <Avatar>
          <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
          <AvatarFallback>CN</AvatarFallback>
        </Avatar>
        <div className="flex flex-1 items-center justify-between">
          <div className="flex w-max flex-1 flex-col truncate pl-2 text-sm">
            <span className="truncate">{name}</span>
            <span>{description || 'no description'}</span>
          </div>
          <div className="flex items-center">
            {!isHover && !showDropdown && !isDragging ? (
              <Badge
                variant={
                  deploymentStatus === DeploymentStatus.UnDeployed ? 'destructive' : 'secondary'
                }
                className={cn(
                  'p-1',
                  deploymentStatus === DeploymentStatus.Deployed ? 'bg-green-700 text-slate-50' : ''
                )}
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
                      <MoreHorizontal className="size-4" />
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
                <div {...attributes} {...listeners}>
                  <DraggableHandle className="size-4 cursor-grab" />
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </Link>
  );
};

export { WorkflowCard };
