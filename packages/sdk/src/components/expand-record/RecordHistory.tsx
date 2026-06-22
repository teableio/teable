import type { QueryFunctionContext } from '@tanstack/react-query';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { IFieldVo } from '@teable/core';
import { DateFormattingPreset, FieldType, TimeFormatting, validateCellValue } from '@teable/core';
import { ArrowRight, ChevronRight, MagicAi } from '@teable/icons';
import type {
  IGetRecordHistoryQuery,
  IItemBaseCollaboratorUser,
  IRecordHistoryItemVo,
  IRecordHistoryVo,
} from '@teable/openapi';
import {
  getFields,
  getRecordHistory,
  getRecordListHistory,
  getUserCollaborators,
} from '@teable/openapi';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import dayjs from 'dayjs';
import type { ReactNode } from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactQueryKeys } from '../../config';
import { useTranslation } from '../../context/app/i18n';
import { useBaseId, useFieldStaticGetter, useFields, useIsHydrated, useTableId } from '../../hooks';
import { createFieldInstance, type IFieldInstance } from '../../model';
import { CellValue, UserAvatar } from '../cell-value';
import { CollaboratorWithHoverCard } from '../collaborator';
import { UserOption } from '../editor';
import { BaseMultipleSelect } from '../filter/view-filter/component/base';
import type { IDateRangeValue } from '../filter/view-filter/component/filterDatePicker/DateRangePicker';
import { DateRangePicker } from '../filter/view-filter/component/filterDatePicker/DateRangePicker';
import { InfiniteTable } from '../table';
import { CopyButton } from './components';

interface IRecordHistoryProps {
  tableId?: string;
  recordId?: string;
  onRecordClick?: (recordId: string) => void;
}

const SUPPORTED_COPY_FIELD_TYPES = [FieldType.SingleLineText, FieldType.LongText];
const RECORD_HISTORY_TIME_FORMAT = 'YYYY/MM/DD HH:mm';

const stringifyCellValue = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyCellValue(item))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const text = record.title ?? record.name ?? record.email ?? record.id;
    if (typeof text === 'string') return text;
  }
  return JSON.stringify(value);
};

const getCellValueTooltipText = (field: IFieldVo, value: unknown): string => {
  try {
    return createFieldInstance(field).cellValue2String(value);
  } catch {
    return stringifyCellValue(value);
  }
};

const CellValueWithTooltip = (props: {
  field: IFieldInstance;
  value: unknown;
  tooltipText?: string;
  copyText?: string;
}) => {
  const { field, value, tooltipText, copyText } = props;
  const { t } = useTranslation();
  const [isOverflow, setIsOverflow] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const isTextField = field.type === FieldType.SingleLineText || field.type === FieldType.LongText;

  const checkOverflow = useCallback(() => {
    const element = contentRef.current;
    if (!element) return;
    setIsOverflow(
      element.scrollHeight > element.clientHeight + 1 ||
        element.scrollWidth > element.clientWidth + 1
    );
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(checkOverflow);
    return () => window.cancelAnimationFrame(frame);
  }, [checkOverflow, tooltipText, value]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(element);

    return () => {
      observer.unobserve(element);
    };
  }, [checkOverflow]);

  const content = (
    <div ref={contentRef} className="line-clamp-6 min-h-6 py-0.5">
      {isTextField ? (
        <div className="w-full whitespace-pre-wrap break-all text-[13px] leading-5">
          {tooltipText}
        </div>
      ) : (
        <div className="flex min-h-5 w-full items-center">
          <CellValue value={value} field={field} className="max-w-full" />
        </div>
      )}
    </div>
  );
  const shouldShowFullButton = Boolean(tooltipText && isOverflow);

  return (
    <div className="group relative size-full min-w-0">
      {content}
      {shouldShowFullButton && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="mt-1 block text-[13px] text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              {t('hidden.showAll')}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            collisionPadding={16}
            className="w-[400px] max-w-[calc(100vw-32px)] p-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="max-h-[50vh] min-h-20 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words p-4 text-[13px] leading-5"
              onWheel={(e) => e.stopPropagation()}
            >
              {tooltipText}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {copyText && (
        <CopyButton
          text={copyText}
          size="icon-xs"
          variant="outline"
          className="absolute right-0 top-0 opacity-0 shadow-sm  transition-opacity duration-200 group-hover:opacity-100 dark:!bg-[#333333]"
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
};

interface IRecordHistoryFieldOption {
  value: string;
  label: string;
  field: IFieldInstance;
}

interface IRecordHistoryUserOption {
  value: string;
  label: string;
  email: string;
  avatar?: string | null;
}

interface IRecordHistoryFilterBarProps {
  fields: IFieldInstance[];
  users: IItemBaseCollaboratorUser[];
  fieldIds: string[];
  createdByIds: string[];
  dateRange: IDateRangeValue | null;
  onFieldIdsChange: (value: string[]) => void;
  onCreatedByIdsChange: (value: string[]) => void;
  onDateRangeChange: (value: IDateRangeValue | null) => void;
  onUserSearch: (value: string) => void;
  onReset: () => void;
}

const RecordHistoryFilterBar = (props: IRecordHistoryFilterBarProps) => {
  const {
    fields,
    users,
    fieldIds,
    createdByIds,
    dateRange,
    onFieldIdsChange,
    onCreatedByIdsChange,
    onDateRangeChange,
    onUserSearch,
    onReset,
  } = props;
  const { t } = useTranslation();
  const getFieldStatic = useFieldStaticGetter();

  const fieldOptions = useMemo<IRecordHistoryFieldOption[]>(
    () =>
      fields.map((field) => ({
        value: field.id,
        label: field.name,
        field,
      })),
    [fields]
  );

  const userOptions = useMemo<IRecordHistoryUserOption[]>(
    () =>
      users.map((user) => ({
        value: user.id,
        label: user.name,
        email: user.email,
        avatar: user.avatar,
      })),
    [users]
  );

  const renderFieldOption = useCallback(
    (option: IRecordHistoryFieldOption) => {
      const { field } = option;
      const { Icon } = getFieldStatic(field.type, {
        isLookup: field.isLookup,
        isConditionalLookup: field.isConditionalLookup,
        hasAiConfig: Boolean(field.aiConfig),
      });
      return (
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0" />
          <span className="truncate" title={option.label}>
            {option.label}
          </span>
        </div>
      );
    },
    [getFieldStatic]
  );

  const renderFieldDisplay = useCallback(
    (option: IRecordHistoryFieldOption) => {
      const { field } = option;
      const { Icon } = getFieldStatic(field.type, {
        isLookup: field.isLookup,
        isConditionalLookup: field.isConditionalLookup,
        hasAiConfig: Boolean(field.aiConfig),
      });
      return (
        <div className="flex h-6 max-w-32 items-center gap-1.5 rounded bg-secondary px-2 text-xs">
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{option.label}</span>
        </div>
      );
    },
    [getFieldStatic]
  );

  const renderUserOption = useCallback((option: IRecordHistoryUserOption) => {
    return (
      <UserOption
        className="w-full gap-2 truncate"
        avatar={option.avatar}
        name={option.label}
        email={option.email}
      />
    );
  }, []);

  const renderUserDisplay = useCallback((option: IRecordHistoryUserOption) => {
    return (
      <div className="flex h-6 max-w-32 items-center gap-1.5 rounded bg-secondary pl-1 pr-2 text-xs">
        <UserAvatar name={option.label} avatar={option.avatar} className="size-5" />
        <span className="truncate">{option.label}</span>
      </div>
    );
  }, []);

  const hasFilter = fieldIds.length > 0 || createdByIds.length > 0 || dateRange != null;

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-background px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        <BaseMultipleSelect
          value={fieldIds}
          options={fieldOptions}
          onSelect={onFieldIdsChange}
          displayRender={renderFieldDisplay}
          optionRender={renderFieldOption}
          className="h-8 w-44"
          popoverClassName="w-64"
          placeholderClassName="text-xs"
          placeholder={t('expandRecord.recordHistory.allFields')}
          notFoundText={t('common.noRecords')}
        />
        <BaseMultipleSelect
          value={createdByIds}
          options={userOptions}
          onSelect={onCreatedByIdsChange}
          displayRender={renderUserDisplay}
          optionRender={renderUserOption}
          onSearch={onUserSearch}
          className="h-8 w-44"
          popoverClassName="w-72"
          placeholderClassName="text-xs"
          placeholder={t('expandRecord.recordHistory.allUsers')}
          notFoundText={t('common.noRecords')}
        />
        <DateRangePicker
          value={dateRange}
          onChange={onDateRangeChange}
          placeholder={t('expandRecord.recordHistory.filterTime')}
          options={{
            formatting: {
              date: DateFormattingPreset.Asian,
              time: TimeFormatting.None,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
          }}
          className="h-8 w-52 text-xs"
        />
      </div>
      {hasFilter && (
        <Button variant="outline" size="sm" onClick={onReset}>
          {t('expandRecord.recordHistory.clearFilter')}
        </Button>
      )}
    </div>
  );
};

export const RecordHistory = (props: IRecordHistoryProps) => {
  const { recordId, onRecordClick } = props;
  const anchorTableId = useTableId() as string;
  const tableId = props.tableId || anchorTableId;
  const baseId = useBaseId();
  const { t } = useTranslation();
  const isHydrated = useIsHydrated();
  const getFieldStatic = useFieldStaticGetter();
  const fields = useFields({ withHidden: true });

  const [userMap, setUserMap] = useState<IRecordHistoryVo['userMap']>({});
  const [fieldIds, setFieldIds] = useState<string[]>([]);
  const [createdByIds, setCreatedByIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<IDateRangeValue | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserMap, setSelectedUserMap] = useState<Record<string, IItemBaseCollaboratorUser>>(
    {}
  );

  const shouldFetchFields = tableId !== anchorTableId;

  const { data: fetchedFields } = useQuery({
    queryKey: ReactQueryKeys.fieldList(tableId),
    queryFn: ({ queryKey }) => getFields(queryKey[1]).then((res) => res.data),
    enabled: Boolean(shouldFetchFields && tableId),
  });

  const targetFields = useMemo(
    () => (shouldFetchFields ? fetchedFields?.map((field) => createFieldInstance(field)) : fields),
    [fetchedFields, fields, shouldFetchFields]
  );
  const visibleFields = useMemo(
    () => targetFields?.filter((field) => field.canReadFieldRecord) ?? [],
    [targetFields]
  );

  const historyQuery = useMemo<IGetRecordHistoryQuery | undefined>(
    () => ({
      ...(fieldIds.length ? { fieldIds } : {}),
      ...(createdByIds.length ? { createdByIds } : {}),
      ...(dateRange?.exactDate ? { startDate: dateRange.exactDate } : {}),
      ...(dateRange?.exactDateEnd ? { endDate: dateRange.exactDateEnd } : {}),
    }),
    [createdByIds, dateRange?.exactDate, dateRange?.exactDateEnd, fieldIds]
  );

  const { data: collaboratorsData } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorListUser(baseId as string, {
      includeSystem: true,
      skip: 0,
      take: 100,
      search: userSearch,
    }),
    queryFn: ({ queryKey }) =>
      getUserCollaborators(queryKey[1], queryKey[2]).then((res) => res.data),
    enabled: Boolean(baseId),
  });

  const users = useMemo(() => {
    const userMap = new Map<string, IItemBaseCollaboratorUser>();

    createdByIds.forEach((id) => {
      const user = selectedUserMap[id];
      if (user) {
        userMap.set(id, user);
      }
    });

    collaboratorsData?.users.forEach((user) => {
      userMap.set(user.id, user);
    });

    return Array.from(userMap.values());
  }, [collaboratorsData?.users, createdByIds, selectedUserMap]);

  const queryFn = async ({
    queryKey,
    pageParam,
  }: QueryFunctionContext<
    ReturnType<typeof ReactQueryKeys.getRecordHistory>,
    string | undefined
  >) => {
    const recordId = queryKey[2] as string | undefined;
    const query = queryKey[3] as IGetRecordHistoryQuery | undefined;
    const res = recordId
      ? await getRecordHistory(queryKey[1] as string, recordId, {
          ...query,
          cursor: pageParam,
        })
      : await getRecordListHistory(queryKey[1] as string, {
          ...query,
          cursor: pageParam,
        });
    setUserMap((prev) => ({ ...prev, ...res.data.userMap }));
    return res.data;
  };

  const { data, isFetching, isLoading, hasNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ReactQueryKeys.getRecordHistory(tableId, recordId, historyQuery),
    queryFn,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const allRows = useMemo(
    () => (data ? data.pages.flatMap((page) => page.historyList) : []),
    [data]
  );

  const columns: ColumnDef<IRecordHistoryItemVo>[] = useMemo(() => {
    const actionVisible = !recordId && onRecordClick;
    const renderHistoryCell = (
      cell: IRecordHistoryItemVo['before'] | IRecordHistoryItemVo['after']
    ) => {
      const validatedCellValue = validateCellValue(cell.meta as IFieldVo, cell.data);
      const cellValue = validatedCellValue.success ? validatedCellValue.data : undefined;
      const canCopy = SUPPORTED_COPY_FIELD_TYPES.includes(cell.meta.type);
      const copyText = typeof cellValue === 'string' ? cellValue : undefined;
      const tooltipText = getCellValueTooltipText(cell.meta as IFieldVo, cellValue);

      return (
        <Fragment>
          {cellValue != null ? (
            <CellValueWithTooltip
              value={cellValue}
              field={cell.meta as IFieldInstance}
              tooltipText={tooltipText}
              copyText={canCopy ? copyText : undefined}
            />
          ) : (
            <span className="flex min-h-6 items-center text-muted-foreground">
              {t('common.empty')}
            </span>
          )}
        </Fragment>
      );
    };

    const tableColumns: ColumnDef<IRecordHistoryItemVo>[] = [
      {
        accessorKey: 'createdTime',
        header: t('expandRecord.recordHistory.createdTime'),
        size: 160,
        minSize: 160,
        cell: ({ row }) => {
          const createdTime = row.getValue<string>('createdTime');
          const createdDate = dayjs(createdTime);
          const formattedTime = createdDate.format(RECORD_HISTORY_TIME_FORMAT);
          return (
            <div
              className="flex min-h-6 items-center text-[13px] tabular-nums leading-5"
              title={formattedTime}
            >
              {formattedTime}
            </div>
          );
        },
      },
      {
        accessorKey: 'createdBy',
        header: t('expandRecord.recordHistory.createdBy'),
        size: 144,
        minSize: 144,
        cell: ({ row }) => {
          const createdBy = row.getValue<string>('createdBy');
          const user = userMap[createdBy];

          if (!user) return null;

          const { id, name, avatar, email } = user;
          const avatarNode =
            id === 'aiRobot' ? (
              <div className="flex size-6 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-amber-500">
                <MagicAi className="size-4 text-amber-500" />
              </div>
            ) : (
              <UserAvatar
                name={name}
                avatar={avatar}
                className="size-6 shrink-0 cursor-pointer border"
              />
            );
          const hoverAvatar = (
            id === 'aiRobot' ? (
              <div className="flex size-6 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-amber-500">
                <MagicAi className="size-4 text-amber-500" />
              </div>
            ) : (
              avatar
            )
          ) as ReactNode;

          return (
            <div className="flex min-h-6 w-full min-w-0 items-center">
              <CollaboratorWithHoverCard id={id} name={name} avatar={hoverAvatar} email={email}>
                <span className="inline-flex h-6 w-full min-w-0 items-center gap-2 align-top">
                  {avatarNode}
                  <span className="min-w-0 flex-1 truncate leading-5" title={name}>
                    {name}
                  </span>
                </span>
              </CollaboratorWithHoverCard>
            </div>
          );
        },
      },
      {
        accessorKey: 'field',
        header: t('noun.field'),
        size: 116,
        minSize: 116,
        cell: ({ row }) => {
          const after = row.getValue<IRecordHistoryItemVo['after']>('after');
          const { name: fieldName, type: fieldType } = after.meta;
          const { Icon } = getFieldStatic(fieldType, {
            isLookup: after.meta.isLookup,
            isConditionalLookup: after.meta.isConditionalLookup,
            hasAiConfig: false,
          });
          return (
            <div className="flex min-h-6 w-full min-w-0 items-center gap-x-1">
              <Icon className="size-4 shrink-0" />
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
                      {fieldName}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[400px] break-words">{fieldName}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          );
        },
      },
      {
        accessorKey: 'before',
        header: t('expandRecord.recordHistory.before'),
        size: Number.MAX_SAFE_INTEGER,
        minSize: 150,
        cell: ({ row }) => {
          const after = row.getValue<IRecordHistoryItemVo['after']>('after');
          if (after.meta.type === FieldType.Button) {
            return (
              <div className="flex min-h-6 w-full min-w-0 items-center leading-5 text-muted-foreground">
                -
              </div>
            );
          }
          const before = row.getValue<IRecordHistoryItemVo['before']>('before');
          return renderHistoryCell(before);
        },
      },
      {
        accessorKey: 'arrow',
        header: '',
        size: 24,
        minSize: 24,
        cell: () => {
          return (
            <div className="-mx-4 flex min-h-6 w-[calc(100%+2rem)] items-center justify-center">
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            </div>
          );
        },
      },
      {
        accessorKey: 'after',
        header: t('expandRecord.recordHistory.after'),
        size: Number.MAX_SAFE_INTEGER,
        minSize: 150,
        cell: ({ row }) => {
          const after = row.getValue<IRecordHistoryItemVo['after']>('after');
          if (after.meta.type === FieldType.Button) {
            return (
              <div className="flex min-h-6 w-full min-w-0 items-center leading-5">
                {t('expandRecord.recordHistory.buttonClicked')}
              </div>
            );
          }
          return renderHistoryCell(after);
        },
      },
    ];

    if (actionVisible) {
      tableColumns.push({
        accessorKey: 'recordId',
        header: t('common.actions'),
        size: 136,
        minSize: 136,
        cell: ({ row }) => {
          const recordId = row.getValue<string>('recordId');
          return (
            <div className="flex min-h-6 w-full items-center pr-4">
              <Button
                size="xs"
                variant="ghost"
                className="h-6 gap-1 border border-transparent bg-transparent pr-1 font-normal hover:border-border hover:bg-background"
                onClick={() => onRecordClick(recordId)}
              >
                {t('expandRecord.recordHistory.viewRecord')}
                <ChevronRight className="size-4 text-muted-foreground" />
              </Button>
            </div>
          );
        },
      });
    }

    return tableColumns;
  }, [recordId, userMap, t, getFieldStatic, onRecordClick]);

  const fetchNextPageInner = useCallback(() => {
    if (!isFetching && hasNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  const resetFilter = useCallback(() => {
    setFieldIds([]);
    setCreatedByIds([]);
    setDateRange(null);
    setUserSearch('');
  }, []);

  if (!isHydrated) return null;

  return (
    <div className="flex size-full flex-col overflow-hidden">
      <RecordHistoryFilterBar
        fields={visibleFields}
        users={users}
        fieldIds={fieldIds}
        createdByIds={createdByIds}
        dateRange={dateRange}
        onFieldIdsChange={(value) => setFieldIds(value)}
        onCreatedByIdsChange={(value) => {
          setCreatedByIds(value);
          setSelectedUserMap((prev) => {
            const next = { ...prev };

            users.forEach((user) => {
              if (value.includes(user.id)) {
                next[user.id] = user;
              }
            });

            Object.keys(next).forEach((id) => {
              if (!value.includes(id)) {
                delete next[id];
              }
            });

            return next;
          });
        }}
        onDateRangeChange={setDateRange}
        onUserSearch={setUserSearch}
        onReset={resetFilter}
      />
      <InfiniteTable
        rows={allRows}
        columns={columns}
        className="min-h-0 flex-1 sm:overflow-x-hidden [&_table]:table-fixed [&_td]:items-start [&_td]:py-3 [&_tr]:min-w-0 [&_tr]:leading-5"
        fetchNextPage={fetchNextPageInner}
        isLoading={isLoading}
      />
    </div>
  );
};
