import type { IQueryBaseRo } from '@teable/openapi';
import { RecordItem, RecordList } from '@teable/sdk/components';
import { useRowCount } from '@teable/sdk/hooks';
import { useInfiniteRecords } from '@teable/sdk/hooks/use-infinite-records';
import { Skeleton } from '@teable/ui-lib/shadcn';
import { useCalendar } from '../hooks';

interface IEventListProps {
  query?: IQueryBaseRo;
}

export const EventList = (props: IEventListProps) => {
  const { query } = props;
  const rowCount = useRowCount();
  const { setExpandRecordId } = useCalendar();

  const { onVisibleRegionChanged, recordMap } = useInfiniteRecords(query);

  return (
    <RecordList
      className="h-full"
      itemHeight={36}
      itemClassName="p-0 rounded-md aria-selected:bg-transparent aria-selected:text-inherit"
      itemRender={(index) => {
        const record = recordMap[index];
        if (!record) {
          return <Skeleton className="h-[30px] w-full" />;
        }
        return <RecordItem title={record.name} className="bg-background py-1" />;
      }}
      rowCount={rowCount ?? 0}
      onSelect={(index) => {
        setExpandRecordId(recordMap[index]?.id);
      }}
      onVisibleChange={(range) => {
        const [startIndex, endIndex] = range;
        onVisibleRegionChanged({
          y: startIndex,
          height: endIndex - startIndex,
        });
      }}
    />
  );
};
