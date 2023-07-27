import { Table2 } from '@teable-group/icons';
import { useTable } from '@teable-group/sdk/hooks';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ViewList } from '../view/list/ViewList';
dayjs.extend(relativeTime);

export const TableHeader: React.FC = () => {
  const table = useTable();
  if (!table) {
    return <></>;
  }

  return (
    <div className="flex flex-row px-2">
      <div className='pb-1" flex justify-center items-center grow-0 shrink-0 relative overflow-hidden gap-2 px-2'>
        <Table2 className="w-5 h-5" />
        <div className="flex flex-col justify-center items-start grow-0 shrink-0 h-7 relative overflow-hidden">
          <div className="text-sm leading-none">{table.name}</div>
          <div className="text-xs text-slate-400 leading-none">
            last modified: {dayjs(table.lastModifiedTime).fromNow()}
          </div>
        </div>
      </div>
      <ViewList />
    </div>
  );
};
