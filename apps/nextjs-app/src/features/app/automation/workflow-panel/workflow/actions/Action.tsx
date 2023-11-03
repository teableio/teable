import { AlertTriangle, Plus, DraggableHandle, MoreHorizontal } from '@teable-group/icons';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuContent,
} from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useRouter } from 'next/router';
import { useMemo, forwardRef, useState } from 'react';
import { AddActionDropMenu } from '../../../components';
import { NodeStatus } from './NodeStatus';

interface IActionProps {
  id: string;
  type?: string;
  addable?: boolean;
  draggable?: boolean;
  isDragging?: boolean;
  description?: string;
  statusClassName?: string;
  handleProps?: React.HTMLAttributes<HTMLDivElement>;
}

const Action = forwardRef<HTMLDivElement, IActionProps>((props, ref) => {
  const {
    isDragging,
    handleProps,
    id: actionId,
    addable = false,
    statusClassName,
    draggable = true,
    description = 'When a record matches',
  } = props;

  const router = useRouter();
  const {
    query: { automationId, baseId, actionId: routerActionId },
  } = router;

  const [isHover, setHover] = useState(false);
  const [dropDownVisible, setDropDownVisible] = useState(false);
  const isActive = useMemo(() => routerActionId === actionId, [actionId, routerActionId]);

  const handleActionChange = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation();
    router.push(
      {
        pathname: '/base/[baseId]/automation/[automationId]/[actionId]',
        query: { baseId, automationId, actionId },
      },
      undefined,
      { shallow: true }
    );
  };

  return (
    <div className="group relative my-4 w-96">
      <div
        ref={ref}
        tabIndex={0}
        role="button"
        className={classNames(
          'flex items-center w-full relative',
          'hover:border-blue-300',
          isActive ? 'outline outline-blue-500 border-blue-300' : null,
          'outline-2 border-2 rounded shadow-sm'
        )}
        onClick={handleActionChange}
        onKeyDown={handleActionChange}
        onMouseMove={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div
          className={classNames(
            'absolute -left-5',
            'border-y-2 border-secondary/10',
            statusClassName,
            isDragging ? 'hidden' : null
          )}
          style={{
            transform: `translate(calc(-100%), 0)`,
          }}
        >
          <NodeStatus isActive={isActive}></NodeStatus>
        </div>

        <div
          className={classNames(
            'flex items-center bg-card cursor-pointer relative p-3 w-full truncate rounded'
          )}
        >
          <div className="px-2">
            <AlertTriangle className="h-12 w-12 px-2"></AlertTriangle>
          </div>

          <div className="flex flex-1 flex-col truncate">
            <div>{actionId}</div>
            <div className="truncate">{description}</div>
          </div>

          <div
            className={classNames(
              draggable && (isHover || dropDownVisible || isActive) ? '' : 'opacity-0',
              'flex px-1 items-end'
            )}
          >
            <DropdownMenu
              open={dropDownVisible}
              onOpenChange={(visible) => {
                setDropDownVisible(visible);
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
                  Duplicate action
                </DropdownMenuItem>
                <DropdownMenuItem>Delete action</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div {...handleProps}>
              <DraggableHandle />
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -top-5 z-50 w-full cursor-pointer">
        <AddActionDropMenu>
          <div
            className={classNames(
              'hover:opacity-100 hover:bg-blue-300',
              'flex items-center justify-center',
              'rounded-full opacity-0 my-2 h-2',
              addable ? '' : 'hidden'
            )}
          >
            <Plus className="rounded bg-blue-500 text-secondary" />
          </div>
        </AddActionDropMenu>
      </div>

      <AddActionDropMenu>
        <div
          role="button"
          className={classNames(
            'hover:opacity-100 hover:bg-blue-300 rounded-full opacity-0 m-2 h-2 flex items-center justify-center',
            'last:hidden',
            addable ? '' : 'hidden'
          )}
        >
          <Plus className="rounded bg-blue-500 text-secondary" />
        </div>
      </AddActionDropMenu>
    </div>
  );
});

Action.displayName = 'Action';

export { Action };
