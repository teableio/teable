import type { QueryFunctionContext } from '@tanstack/react-query';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { IFieldVo } from '@teable/core';
import { FieldType, validateCellValue } from '@teable/core';
import { ArrowRight, ChevronRight, MagicAi } from '@teable/icons';
import type { IRecordHistoryItemVo, IRecordHistoryVo } from '@teable/openapi';
import { getRecordHistory, getRecordListHistory } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib';
import dayjs from 'dayjs';
import type { ReactNode } from 'react';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { ReactQueryKeys } from '../../config';
import { useTranslation } from '../../context/app/i18n';
import { useFieldStaticGetter, useIsHydrated, useTableId } from '../../hooks';
import type { IFieldInstance } from '../../model';
import { CellValue } from '../cell-value';
import { OverflowTooltip } from '../cell-value/components';
import { CollaboratorWithHoverCard } from '../collaborator';
import { InfiniteTable } from '../table';
import { CopyButton } from './components';

interface IRecordHistoryProps {
  recordId?: string;
  onRecordClick?: (recordId: string) => void;
}

const SUPPORTED_COPY_FIELD_TYPES = [FieldType.SingleLineText, FieldType.LongText];

export const RecordHistory = (props: IRecordHistoryProps) => {
  const { recordId, onRecordClick } = props;
  const tableId = useTableId() as string;
  const { t } = useTranslation();
  const isHydrated = useIsHydrated();
  const getFieldStatic = useFieldStaticGetter();

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
              <CollaboratorWithHoverCard
                id={id}
                name={name}
                avatar={
                  (id === 'aiRobot' ? (
                    <div className="flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-amber-500">
                      <MagicAi className="size-4 text-amber-500" />
                    </div>
                  ) : (
                    avatar
                  )) as ReactNode
                }
                email={email}
              />
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
          const { Icon } = getFieldStatic(fieldType, {
            isLookup: false,
            hasAiConfig: false,
          });
          return (
            <div className="flex items-center gap-x-1">
              <Icon className="shrink-0" />
              <OverflowTooltip text={fieldName} ellipsis className="flex-1 text-[13px]" />
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
          const validatedCellValue = validateCellValue(before.meta as IFieldVo, before.data);
          const cellValue = validatedCellValue.success ? validatedCellValue.data : undefined;
          return (
            <div className={cn('group relative', actionVisible ? 'w-52' : 'w-[264px]')}>
              {cellValue != null ? (
                <Fragment>
                  <CellValue
                    value={cellValue}
                    field={before.meta as IFieldInstance}
                    className={actionVisible ? 'max-w-52' : 'max-w-[264px]'}
                  />
                  {SUPPORTED_COPY_FIELD_TYPES.includes(before.meta.type) && (
                    <CopyButton
                      text={cellValue}
                      size="xs"
                      variant="outline"
                      className="absolute right-0 top-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    />
                  )}
                </Fragment>
              ) : (
                <span className="text-gray-500">{t('common.empty')}</span>
              )}
            </div>
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
          const validatedCellValue = validateCellValue(after.meta as IFieldVo, after.data);
          const cellValue = validatedCellValue.success ? validatedCellValue.data : undefined;
          return (
            <div className={cn('group relative', actionVisible ? 'w-52' : 'w-[264px]')}>
              {cellValue != null ? (
                <Fragment>
                  <CellValue
                    value={cellValue}
                    field={after.meta as IFieldInstance}
                    className={actionVisible ? 'max-w-52' : 'max-w-[264px]'}
                  />
                  {SUPPORTED_COPY_FIELD_TYPES.includes(after.meta.type) && (
                    <CopyButton
                      text={cellValue}
                      size="xs"
                      variant="outline"
                      className="absolute right-0 top-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    />
                  )}
                </Fragment>
              ) : (
                <span className="text-gray-500">{t('common.empty')}</span>
              )}
            </div>
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

  const fetchNextPageInner = useCallback(() => {
    if (!isFetching && nextCursor) {
      fetchNextPage();
    }
  }, [fetchNextPage, isFetching, nextCursor]);

  if (!isHydrated || isLoading) return null;

  return (
    <InfiniteTable
      rows={allRows}
      columns={columns}
      className="sm:overflow-x-hidden"
      fetchNextPage={fetchNextPageInner}
    />
  );
};
