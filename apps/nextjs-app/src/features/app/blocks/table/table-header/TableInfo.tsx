import { Table2 } from '@teable-group/icons';
import { useConnection, useTable } from '@teable-group/sdk/hooks';
import { Spin } from '@teable-group/ui-lib/base';
import classNames from 'classnames';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);

export const TableInfo: React.FC<{ className?: string }> = ({ className }) => {
  const { connected } = useConnection();
  const table = useTable();
  return (
    <div
      className={classNames(
        'flex justify-center items-center relative overflow-hidden gap-2',
        className
      )}
    >
      {connected ? <Table2 className="w-5 h-5" /> : <Spin />}
      <div className="flex flex-col justify-center items-start grow-0 shrink-0 h-7">
        <div className="text-sm leading-none">{table?.name}</div>
        <div className="text-xs text-slate-400 leading-none">
          last modified: {dayjs(table?.lastModifiedTime).fromNow()}
        </div>
      </div>
    </div>
  );
};
