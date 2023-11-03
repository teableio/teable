import { useSortable } from '@dnd-kit/sortable';
import { MoreHorizontal } from '@teable-group/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useRouter } from 'next/router';
import { NodeStatus } from '../../NodeStatus';

interface IConditionItemProps {
  id: string;
  index: number;
  children: React.ReactElement[] | React.ReactElement;
}

const ConditionItem = (props: IConditionItemProps) => {
  const { id, children, index: order } = props;
  const router = useRouter();
  const {
    query: { automationId, baseId, actionId, index },
  } = router;
  const sortProps = useSortable({
    id: id,
  });
  const { setNodeRef } = sortProps;
  const goDetail = () => {
    router.push(
      {
        pathname: `/base/[baseId]/automation/[automationId]/[actionId]`,
        query: { baseId, automationId, actionId: id, index: order },
      },
      undefined,
      { shallow: true }
    );
  };
  const isFocus = actionId === id && Number(index) === order;

  return (
    <div
      className={classNames(
        'bg-card p-2 border-2 hover:border-blue-300 cursor-pointer shadow-secondary relative',
        isFocus ? 'border-blue-300' : ''
      )}
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onKeyDown={() => void 0}
      onClick={goDetail}
    >
      {/* header */}
      <div className="flex items-center justify-between px-2">
        <div
          className={classNames('absolute -left-5', 'border-y-2 border-secondary/10')}
          style={{
            transform: `translate(calc(-100%), 0)`,
          }}
        >
          <NodeStatus isActive={isFocus}></NodeStatus>
          <div className="absolute right-[-18px] top-[50%] h-0.5 w-[18px]  bg-slate-300"></div>
        </div>

        <div>
          <span>If</span>
          <Button variant="link" className="p-1">
            conditions are met
          </Button>
        </div>
        <div className="flex items-center">
          <Button variant="ghost">+</Button>
          <DropdownMenu>
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
        </div>
      </div>

      {/* description */}
      <div className="truncate px-2 pb-2">Send an email Send an email</div>

      {/* actions */}
      <div className="flex">
        <div className="h-auto w-1 bg-secondary"></div>
        <div className="flex flex-col pl-2">{children}</div>
      </div>
    </div>
  );
};

export { ConditionItem };
