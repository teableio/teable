import type { ILinkCellValue } from '@teable/core';
import { Skeleton } from '@teable/ui-lib';
import { debounce } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import { useRowCount, useSearch } from '../../hooks';
import { useInfiniteRecords } from '../../hooks/use-infinite-records';
import { RecordItem } from './RecordItem';
import { RecordList } from './RecordList';
import { RecordSearch } from './RecordSearch';

interface ISocketRecordListProps {
  lookupFieldId: string;
  take?: number;
  selectedRecordIds?: string[];
  onSelected?: (record: ILinkCellValue) => void;
  onClick?: (record: ILinkCellValue) => void;
}

export const SocketRecordList = (props: ISocketRecordListProps) => {
  const { selectedRecordIds, lookupFieldId, onSelected, onClick } = props;
  const rowCount = useRowCount();
  const { setValue: setSearch, setFieldId, setHideNotMatchRow } = useSearch();
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    setFieldId(lookupFieldId);
  }, [lookupFieldId, setFieldId]);

  useEffect(() => {
    setHideNotMatchRow(true);
  }, [setHideNotMatchRow]);

  const updateSearchParam = useMemo(() => {
    return debounce((search: string) => {
      return setSearch(search);
    }, 300);
  }, [setSearch]);

  const { onVisibleRegionChanged, recordMap } = useInfiniteRecords();
  useEffect(() => updateSearchParam(searchInput), [searchInput, updateSearchParam]);

  return (
    <RecordList
      className="h-full"
      onSelect={(index) => {
        const record = recordMap[index];
        if (!record || !lookupFieldId) {
          return;
        }
        const title = record.getCellValueAsString(lookupFieldId);
        onClick?.({ id: record.id, title });
        if (!selectedRecordIds?.includes(record.id)) {
          onSelected?.(record);
        }
      }}
      itemRender={(index) => {
        const record = recordMap[index];
        if (!record || !lookupFieldId) {
          return <Skeleton className="size-full"></Skeleton>;
        }
        const title = record.getCellValueAsString(lookupFieldId);
        const isActive = selectedRecordIds?.includes(record.id);
        return <RecordItem title={title} active={isActive} />;
      }}
      rowCount={rowCount ?? 0}
      onVisibleChange={(range) => {
        const [startIndex, endIndex] = range;
        onVisibleRegionChanged({
          y: startIndex,
          height: endIndex - startIndex,
        });
      }}
    >
      <RecordSearch value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
    </RecordList>
  );
};
