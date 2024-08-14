import type { QueryFunctionContext } from '@tanstack/react-query';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ArrowRight, ChevronRight } from '@teable/icons';
import type { IRecordHistoryItemVo, IRecordHistoryVo } from '@teable/openapi';
import { getRecordHistory, getRecordListHistory } from '@teable/openapi';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  Button,
} from '@teable/ui-lib';
import dayjs from 'dayjs';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactQueryKeys } from '../../config';
import { useTranslation } from '../../context/app/i18n';
import { useFieldStaticGetter, useIsHydrated, useTableId } from '../../hooks';
import type { IFieldInstance } from '../../model';
import { CellValue } from '../cell-value';
import { OverflowTooltip } from '../cell-value/components';
import { CollaboratorWithHoverCard } from '../collaborator';

interface IRecordHistoryProps {
  recordId?: string;
  onRecordClick?: (recordId: string) => void;
}

export const RecordHistory = (props: IRecordHistoryProps) => {
  const { recordId, onRecordClick } = props;
  const tableId = useTableId() as string;
  const { t } = useTranslation();
  const isHydrated = useIsHydrated();
  const getFieldStatic = useFieldStaticGetter();

  const listRef = useRef<HTMLDivElement>(null);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>();
  const [userMap, setUserMap] = useState<IRecordHistoryVo['userMap']>({});

  const queryFn = async ({ queryKey, pageParam }: QueryFunctionContext) => {
    const recordId = queryKey[2] as string | undefined;
    const res = recordId
      ? await getRecordHistory(queryKey[1] as string, recordId, {
          cursor: pageParam,
        })
      : await getRecordListHistory(queryKey[1] as string, {
          cursor: pageParam,
        });
    setNextCursor(() => res.data.nextCursor);
    setUserMap({ ...userMap, ...res.data.userMap });
    return res.data.historyList;
  };

  const { data, isFetching, isLoading, fetchNextPage } = useInfiniteQuery({
    queryKey: ReactQueryKeys.getRecordHistory(tableId, recordId),
    queryFn,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    getNextPageParam: () => nextCursor,
  });

  const allRows = useMemo(() => (data ? data.pages.flatMap((d) => d) : []), [data]);

  const fetchMoreOnBottomReached = useCallback(
    (containerRefElement?: HTMLDivElement | null) => {
      if (containerRefElement) {
        const { scrollHeight, scrollTop, clientHeight } = containerRefElement;
        const isReachedThreshold = scrollHeight - scrollTop - clientHeight < 30;
        if (!isFetching && nextCursor && isReachedThreshold) {
          fetchNextPage();
        }
      }
    },
    [fetchNextPage, isFetching, nextCursor]
  );

  useEffect(() => {
    fetchMoreOnBottomReached(listRef.current);
  }, [fetchMoreOnBottomReached]);

  const columns: ColumnDef<IRecordHistoryItemVo>[] = useMemo(() => {
    const actionVisible = !recordId && onRecordClick;
    const tableColumns: ColumnDef<IRecordHistoryItemVo>[] = [
      {
        accessorKey: 'createdTime',
        header: t('expandRecord.recordHistory.createdTime'),
        size: 90,
        cell: ({ row }) => {
          const createdTime = row.getValue<string>('createdTime');
          const createdDate = dayjs(createdTime);
          const isToday = createdDate.isSame(dayjs(), 'day');
          return (
            <div className="text-xs" title={createdDate.format('YYYY/MM/DD HH:mm')}>
              {createdDate.format(isToday ? 'HH:mm' : 'YYYY/MM/DD')}
            </div>
          );
        },
      },
      {
        accessorKey: 'createdBy',
        header: t('expandRecord.recordHistory.createdBy'),
        size: 80,
        cell: ({ row }) => {
          const createdBy = row.getValue<string>('createdBy');
          const user = userMap[createdBy];

          if (!user) return null;

          const { id, name, avatar, email } = user;

          return (
            <div className="flex justify-center">
              <CollaboratorWithHoverCard id={id} name={name} avatar={avatar} email={email} />
            </div>
          );
        },
      },
      {
        accessorKey: 'field',
        header: t('noun.field'),
        size: 116,
        cell: ({ row }) => {
          const after = row.getValue<IRecordHistoryItemVo['after']>('after');
          const { name: fieldName, type: fieldType } = after.meta;
          const { Icon } = getFieldStatic(fieldType, false);
          return (
            <div className="flex items-center gap-x-1">
              <Icon className="shrink-0" />
              <OverflowTooltip text={fieldName} maxLine={1} className="flex-1 text-[13px]" />
            </div>
          );
        },
      },
      {
        accessorKey: 'before',
        header: t('expandRecord.recordHistory.before'),
        size: actionVisible ? 220 : 280,
        cell: ({ row }) => {
          const before = row.getValue<IRecordHistoryItemVo['before']>('before');
          return (
            <Fragment>
              {before.data != null ? (
                <CellValue
                  value={before.data}
                  field={before.meta as IFieldInstance}
                  maxLine={4}
                  className={actionVisible ? 'max-w-52' : 'max-w-[264px]'}
                />
              ) : (
                <span className="text-gray-500">{t('common.empty')}</span>
              )}
            </Fragment>
          );
        },
      },
      {
        accessorKey: 'arrow',
        header: '',
        size: 40,
        cell: () => {
          return (
            <div className="flex w-full justify-center">
              <ArrowRight className="text-gray-500" />
            </div>
          );
        },
      },
      {
        accessorKey: 'after',
        header: t('expandRecord.recordHistory.after'),
        size: actionVisible ? 220 : 280,
        cell: ({ row }) => {
          const after = row.getValue<IRecordHistoryItemVo['after']>('after');
          return (
            <Fragment>
              {after.data != null ? (
                <CellValue
                  value={after.data}
                  field={after.meta as IFieldInstance}
                  maxLine={4}
                  className={actionVisible ? 'max-w-52' : 'max-w-[264px]'}
                />
              ) : (
                <span className="text-gray-500">{t('common.empty')}</span>
              )}
            </Fragment>
          );
        },
      },
    ];

    if (actionVisible) {
      tableColumns.push({
        accessorKey: 'recordId',
        header: t('common.actions'),
        size: 120,
        cell: ({ row }) => {
          const recordId = row.getValue<string>('recordId');
          return (
            <Button
              size="xs"
              variant="secondary"
              className="h-6 gap-1 font-normal"
              onClick={() => onRecordClick(recordId)}
            >
              {t('expandRecord.recordHistory.viewRecord')}
              <ChevronRight className="size-4" />
            </Button>
          );
        },
      });
    }

    return tableColumns;
  }, [recordId, userMap, t, getFieldStatic, onRecordClick]);

  const table = useReactTable({
    data: allRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (!isHydrated || isLoading) return null;

  return (
    <div
      ref={listRef}
      className="relative size-full overflow-auto px-2 sm:overflow-x-hidden"
      onScroll={(e) => fetchMoreOnBottomReached(e.target as HTMLDivElement)}
    >
      <Table className="relative scroll-smooth">
        <TableHeader className="sticky top-0 z-10 bg-background">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className="flex h-10 bg-background text-[13px] hover:bg-background"
            >
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    key={header.id}
                    className="flex items-center px-0"
                    style={{
                      width: header.getSize(),
                    }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className="flex text-[13px]">
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className="flex min-h-[40px] items-center px-0"
                    style={{
                      width: cell.column.getSize(),
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                {t('common.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};
