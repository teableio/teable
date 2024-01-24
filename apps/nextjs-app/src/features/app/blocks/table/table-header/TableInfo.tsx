import { Table2 } from '@teable-group/icons';
import { useConnection, useTable } from '@teable-group/sdk/hooks';
import { Spin } from '@teable-group/ui-lib/base';
import classNames from 'classnames';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Emoji } from '@/features/app/components/emoji/Emoji';
dayjs.extend(relativeTime);

export const TableInfo: React.FC<{ className?: string }> = ({ className }) => {
  const { connected } = useConnection();
  const table = useTable();

  const icon = table?.icon ? (
    <Emoji size={'1.25rem'} emoji={table.icon} />
  ) : (
    <Table2 className="size-5" />
  );
  return (
    <div
      className={classNames(
        'flex justify-center items-center relative overflow-hidden gap-2',
        className
      )}
    >
      {connected ? <div className="size-5">{icon}</div> : <Spin />}
      <div className="flex h-7 shrink-0 grow-0 flex-col items-start justify-center">
        <div className="text-sm leading-none">{table?.name}</div>
        <div className="hidden text-xs leading-none text-slate-400 sm:block">
          last modified: {dayjs(table?.lastModifiedTime).fromNow()}
        </div>
      </div>
    </div>
  );
};
