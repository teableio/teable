import { AlertTriangle, Plus } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib';
import classNames from 'classnames';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AddActionDropMenu } from '../../../components';

interface IActionProps {
  type?: string;
  addable?: boolean;
  id: string;
}

const Action = (props: IActionProps) => {
  const { addable = false, id: actionId } = props;
  const router = useRouter();
  const {
    query: { automationId },
  } = router;

  return (
    <div className="">
      <AddActionDropMenu>
        <div
          role="button"
          className={classNames(
            'hover:opacity-100 hover:bg-blue-300 rounded-full opacity-0 m-2 h-2 flex items-center justify-center',
            addable ? '' : 'hidden'
          )}
        >
          <Plus className="text-secondary rounded bg-blue-500" />
        </div>
      </AddActionDropMenu>

      <Link
        href={{
          pathname: '/space/automation/[automationId]/[actionId]',
          query: { automationId: automationId, actionId: actionId },
        }}
        shallow={true}
      >
        <div className="flex px-2 relative">
          <div
            className={classNames(
              // 'outline outline-blue-500',
              'outline-2 flex p-3 items-center border-transparent drop-shadow-sm border-2 hover:border-sky-500 rounded bg-card cursor-pointer shadow-secondary relative'
            )}
          >
            <div
              className="border-y-2 absolute -left-3 border-secondary/10"
              style={{
                transform: `translate(calc(-100%), 0)`,
              }}
            >
              <Button variant="outline" className="group hover:last:display rounded-full" size="xs">
                <AlertTriangle></AlertTriangle>
                <span className="hidden group-hover:block">Finish configuration</span>
              </Button>
            </div>

            <div className="px-2">
              <AlertTriangle className="w-12 h-12"></AlertTriangle>
            </div>
            <span>When a record matches conditions</span>
          </div>
        </div>
      </Link>

      <AddActionDropMenu>
        <div
          role="button"
          className={classNames(
            'hover:opacity-100 hover:bg-blue-300 rounded-full opacity-0 m-2 h-2 flex items-center justify-center last:hidden',
            addable ? '' : 'hidden'
          )}
        >
          <Plus className="text-secondary rounded bg-blue-500" />
        </div>
      </AddActionDropMenu>
    </div>
  );
};

export { Action };
