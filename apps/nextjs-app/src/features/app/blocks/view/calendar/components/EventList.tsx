import type { IQueryBaseRo } from '@teable/openapi';
import { RecordItem, RecordList } from '@teable/sdk/components';
import { useRowCount } from '@teable/sdk/hooks';
import { useInfiniteRecords } from '@teable/sdk/hooks/use-infinite-records';
import { Skeleton } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { useCalendar } from '../hooks';
import { getEventTitle } from '../util';

interface IEventListProps {
  query?: IQueryBaseRo;
}

export const EventList = (props: IEventListProps) => {
  const { query } = props;
  const rowCount = useRowCount();
  const { titleField, startDateField, endDateField, setExpandRecordId } = useCalendar();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const { onVisibleRegionChanged, recordMap } = useInfiniteRecords(query);

  return (
    <RecordList
      className="h-full"
      itemHeight={36}
      itemClassName="p-0 rounded-md aria-selected:bg-transparent aria-selected:text-inherit"
      itemRender={(index) => {
        const record = recordMap[index];

        if (!record || !titleField || !startDateField || !endDateField) {
          return <Skeleton className="h-[30px] w-full" />;
        }

        const title = record.fields[titleField.id];
        const start = record.fields[startDateField.id];
        const displayTitle = getEventTitle(
          titleField.cellValue2String(title) || t('sdk:common.unnamedRecord'),
          start as string,
          startDateField
        );

        return <RecordItem title={displayTitle} className="bg-background py-1" />;
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
