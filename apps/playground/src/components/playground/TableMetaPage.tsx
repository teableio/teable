import { mapTableToDto, type ITableDto, type ITableRecordDto } from '@teable/v2-contract-http';
import type {
  AutoNumberField,
  ButtonField,
  CreatedByField,
  CreatedTimeField,
  DateField,
  DateTimeFormatting,
  Field,
  FormulaField,
  ITableFieldPersistenceDTO,
  ITablePersistenceDTO,
  LastModifiedByField,
  LastModifiedTimeField,
  LinkField,
  LookupField,
  MultipleSelectField,
  NumberField,
  NumberFormatting,
  RatingField,
  RollupField,
  SelectOption,
  SingleLineTextField,
  SingleSelectField,
  Table as TableAggregate,
  UserField,
  View,
  ViewColumnMetaValue,
} from '@teable/v2-core';
import type { TableTemplateDefinition } from '@teable/v2-table-templates';
import {
  Copy,
  ExternalLink,
  FileJson,
  MoreVertical,
  Pencil,
  RefreshCcw,
  Table as TableIcon,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { parseAsStringEnum, useQueryState } from 'nuqs';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { JsonView } from 'react-json-view-lite';
import { toast } from 'sonner';
import { useCopyToClipboard } from 'usehooks-ts';

import { CreateTableDropdown } from '@/components/playground/CreateTableDropdown';
import { FieldCreateDialog } from '@/components/playground/FieldCreateDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { ShareDbDocStatus } from '@/lib/shareDb';
import { renderFieldOptions } from './fieldOptionsVisitor';

const formatViewLabel = (view: View): string =>
  `${view.name().toString()} (${view.type().toString()})`;

const getViewColumnMeta = (
  view: View
): { value: ViewColumnMetaValue | null; error: string | null } => {
  const result = view.columnMeta();
  if (result.isOk()) {
    return { value: result.value.toDto(), error: null };
  }
  return { value: null, error: result.error.message };
};

const sortColumnMeta = (
  columnMeta: ViewColumnMetaValue
): Array<[string, ViewColumnMetaValue[string]]> =>
  Object.entries(columnMeta).sort(([, left], [, right]) => (left.order ?? 0) - (right.order ?? 0));

const formatOptionalBoolean = (value: boolean | undefined): string => {
  if (value === undefined) return '-';
  return value ? 'true' : 'false';
};

const formatOptionalNumber = (value: number | undefined): string => {
  if (value === undefined) return '-';
  return value.toString();
};

const formatOptionalString = (value: string | null | undefined): string => {
  if (value === undefined || value === null) return '-';
  return value;
};

type FormattedRecordValue = {
  text: string;
  node: ReactNode;
  cellClassName?: string;
};

const emptyRecordValue: FormattedRecordValue = {
  text: '-',
  node: <span className="text-xs text-muted-foreground">-</span>,
  cellClassName: 'text-muted-foreground',
};

const isEmptyRecordValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

const stringifyRecordValue = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  try {
    const json = JSON.stringify(value);
    return json ?? String(value);
  } catch {
    return String(value);
  }
};

const formatTextCellValue = (text: string, cellClassName = 'truncate'): FormattedRecordValue => {
  if (!text) return emptyRecordValue;
  return {
    text,
    node: text,
    cellClassName,
  };
};

const formatBadgeListValue = (
  labels: string[],
  options?: {
    variant?: 'secondary' | 'outline' | 'default' | 'destructive';
    maxBadges?: number;
  }
): FormattedRecordValue => {
  if (!labels.length) return emptyRecordValue;
  const maxBadges = options?.maxBadges ?? 3;
  const visible = labels.slice(0, maxBadges);
  const remaining = labels.length - visible.length;
  const renderLabels = remaining > 0 ? [...visible, `+${remaining}`] : visible;
  return {
    text: labels.join(', '),
    node: (
      <div className="flex flex-wrap gap-1">
        {renderLabels.map((label, index) => (
          <Badge key={`${label}-${index}`} variant={options?.variant ?? 'secondary'}>
            {label}
          </Badge>
        ))}
      </div>
    ),
    cellClassName: 'whitespace-normal',
  };
};

const resolveNumberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const resolveBooleanValue = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return null;
};

const formatNumberText = (value: number, formatting: NumberFormatting): string => {
  const dto = formatting.toDto();
  const precision = dto.precision ?? 0;

  if (dto.type === 'percent') {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'percent',
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
    return formatter.format(value);
  }

  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

  if (dto.type === 'currency') {
    const symbol = dto.symbol ?? '$';
    const sign = value < 0 ? '-' : '';
    return `${sign}${symbol}${formatter.format(Math.abs(value))}`;
  }

  return formatter.format(value);
};

const formatDateTimeText = (value: unknown, formatting: DateTimeFormatting): string | null => {
  if (value === undefined || value === null) return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : null;
  if (!date || Number.isNaN(date.getTime())) return null;

  const dto = formatting.toDto();
  const timeZone = dto.timeZone === 'utc' ? 'UTC' : dto.timeZone;

  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
    const year = Number(part('year'));
    const month = Number(part('month'));
    const day = Number(part('day'));
    const hour24 = Number(part('hour'));
    const minute = Number(part('minute'));
    const hour12 = hour24 % 12 || 12;
    const dayPeriod = hour24 >= 12 ? 'PM' : 'AM';

    const pad2 = (val: number) => String(val).padStart(2, '0');
    const tokens: Record<string, string> = {
      YYYY: String(year),
      MM: pad2(month),
      M: String(month),
      DD: pad2(day),
      D: String(day),
      HH: pad2(hour24),
      hh: pad2(hour12),
      mm: pad2(minute),
      A: dayPeriod,
    };

    const formatWithTokens = (pattern: string) =>
      pattern.replace(/YYYY|MM|DD|HH|hh|mm|M|D|A/g, (match) => tokens[match] ?? match);

    const dateText = formatWithTokens(dto.date);
    if (dto.time === 'None') return dateText;
    const timeText = formatWithTokens(dto.time);
    return `${dateText} ${timeText}`.trim();
  } catch {
    return date.toISOString();
  }
};

const formatBooleanValue = (value: unknown): FormattedRecordValue => {
  const bool = resolveBooleanValue(value);
  if (bool !== null) {
    return formatBadgeListValue([bool ? 'Yes' : 'No'], { variant: 'outline' });
  }
  if (Array.isArray(value)) {
    const labels = value
      .map((entry) => resolveBooleanValue(entry))
      .filter((entry): entry is boolean => entry !== null)
      .map((entry) => (entry ? 'Yes' : 'No'));
    return formatBadgeListValue(labels, { variant: 'outline' });
  }
  return formatTextCellValue(stringifyRecordValue(value));
};

type SelectOptionLookup = {
  byId: Map<string, SelectOption>;
  byName: Map<string, SelectOption>;
};

const buildSelectLookup = (options: ReadonlyArray<SelectOption>): SelectOptionLookup => ({
  byId: new Map(options.map((option) => [option.id().toString(), option])),
  byName: new Map(options.map((option) => [option.name().toString(), option])),
});

const resolveSelectLabel = (lookup: SelectOptionLookup, value: unknown): string | null => {
  if (value === undefined || value === null) return null;

  if (typeof value === 'string') {
    return (
      lookup.byId.get(value)?.name().toString() ??
      lookup.byName.get(value)?.name().toString() ??
      value
    );
  }

  if (typeof value === 'object') {
    const candidate = value as { id?: unknown; name?: unknown };
    if (typeof candidate.name === 'string') return candidate.name;
    if (typeof candidate.id === 'string') {
      return lookup.byId.get(candidate.id)?.name().toString() ?? candidate.id;
    }
  }

  return stringifyRecordValue(value);
};

const resolveUserLabel = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const candidate = value as { title?: unknown; name?: unknown; email?: unknown; id?: unknown };
    if (typeof candidate.title === 'string') return candidate.title;
    if (typeof candidate.name === 'string') return candidate.name;
    if (typeof candidate.email === 'string') return candidate.email;
    if (typeof candidate.id === 'string') return candidate.id;
  }
  return stringifyRecordValue(value);
};

const resolveAttachmentLabel = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const candidate = value as { name?: unknown; id?: unknown };
    if (typeof candidate.name === 'string') return candidate.name;
    if (typeof candidate.id === 'string') return candidate.id;
  }
  return stringifyRecordValue(value);
};

const resolveLinkLabel = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const candidate = value as { title?: unknown; name?: unknown; id?: unknown };
    if (typeof candidate.title === 'string') return candidate.title;
    if (typeof candidate.name === 'string') return candidate.name;
    if (typeof candidate.id === 'string') return candidate.id;
  }
  return stringifyRecordValue(value);
};

const formatRecordValue = (field: Field, value: unknown): FormattedRecordValue => {
  if (isEmptyRecordValue(value)) return emptyRecordValue;

  const fieldType = field.type().toString();
  if (fieldType === 'singleLineText') {
    const textField = field as SingleLineTextField;
    const text = stringifyRecordValue(value);
    const showAs = textField.showAs()?.type();
    if (!text) return emptyRecordValue;

    if (showAs === 'url') {
      const href = /^https?:\/\//i.test(text) ? text : `https://${text}`;
      return {
        text,
        node: (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
            {text}
          </a>
        ),
        cellClassName: 'truncate',
      };
    }

    if (showAs === 'email') {
      return {
        text,
        node: (
          <a href={`mailto:${text}`} className="text-primary underline">
            {text}
          </a>
        ),
        cellClassName: 'truncate',
      };
    }

    if (showAs === 'phone') {
      return {
        text,
        node: (
          <a href={`tel:${text}`} className="text-primary underline">
            {text}
          </a>
        ),
        cellClassName: 'truncate',
      };
    }

    return formatTextCellValue(text);
  }

  if (fieldType === 'longText') {
    const text = stringifyRecordValue(value);
    return formatTextCellValue(text);
  }

  if (fieldType === 'number') {
    const number = resolveNumberValue(value);
    if (number === null) return formatTextCellValue(stringifyRecordValue(value));
    const numberField = field as NumberField;
    return formatTextCellValue(
      formatNumberText(number, numberField.formatting()),
      'text-right tabular-nums whitespace-nowrap'
    );
  }

  if (fieldType === 'autoNumber') {
    const number = resolveNumberValue(value);
    if (number === null) return formatTextCellValue(stringifyRecordValue(value));
    return formatTextCellValue(number.toString(), 'text-right tabular-nums whitespace-nowrap');
  }

  if (fieldType === 'rating') {
    const rating = resolveNumberValue(value);
    if (rating === null) return formatTextCellValue(stringifyRecordValue(value));
    const ratingField = field as RatingField;
    const max = ratingField.ratingMax().toNumber();
    return formatTextCellValue(`${rating} / ${max}`, 'text-right tabular-nums whitespace-nowrap');
  }

  if (fieldType === 'checkbox') {
    return formatBooleanValue(value);
  }

  if (fieldType === 'date') {
    const dateField = field as DateField;
    const formatted = formatDateTimeText(value, dateField.formatting());
    return formatted
      ? formatTextCellValue(formatted, 'font-mono text-xs whitespace-nowrap')
      : emptyRecordValue;
  }

  if (fieldType === 'createdTime') {
    const timeField = field as CreatedTimeField;
    const formatted = formatDateTimeText(value, timeField.formatting());
    return formatted
      ? formatTextCellValue(formatted, 'font-mono text-xs whitespace-nowrap')
      : emptyRecordValue;
  }

  if (fieldType === 'lastModifiedTime') {
    const timeField = field as LastModifiedTimeField;
    const formatted = formatDateTimeText(value, timeField.formatting());
    return formatted
      ? formatTextCellValue(formatted, 'font-mono text-xs whitespace-nowrap')
      : emptyRecordValue;
  }

  if (fieldType === 'singleSelect') {
    const selectField = field as SingleSelectField;
    const lookup = buildSelectLookup(selectField.selectOptions());
    const label = resolveSelectLabel(lookup, value);
    return label ? formatBadgeListValue([label], { variant: 'secondary' }) : emptyRecordValue;
  }

  if (fieldType === 'multipleSelect') {
    const selectField = field as MultipleSelectField;
    const lookup = buildSelectLookup(selectField.selectOptions());
    const values = Array.isArray(value) ? value : [value];
    const labels = values
      .map((entry) => resolveSelectLabel(lookup, entry))
      .filter((entry): entry is string => Boolean(entry));
    return formatBadgeListValue(labels, { variant: 'secondary' });
  }

  if (fieldType === 'user') {
    const userField = field as UserField;
    const values = userField.multiplicity().toBoolean()
      ? Array.isArray(value)
        ? value
        : [value]
      : Array.isArray(value)
        ? value.slice(0, 1)
        : [value];
    const labels = values
      .map((entry) => resolveUserLabel(entry))
      .filter((entry): entry is string => Boolean(entry));
    return formatBadgeListValue(labels, { variant: 'outline' });
  }

  if (fieldType === 'createdBy' || fieldType === 'lastModifiedBy') {
    const values = Array.isArray(value) ? value : [value];
    const labels = values
      .map((entry) => resolveUserLabel(entry))
      .filter((entry): entry is string => Boolean(entry));
    return formatBadgeListValue(labels, { variant: 'outline' });
  }

  if (fieldType === 'attachment') {
    const attachments = Array.isArray(value) ? value : [value];
    const labels = attachments
      .map((entry) => resolveAttachmentLabel(entry))
      .filter((entry): entry is string => Boolean(entry));
    if (!labels.length) return emptyRecordValue;
    if (labels.length === 1) return formatBadgeListValue([labels[0]], { variant: 'outline' });
    return {
      text: labels.join(', '),
      node: <Badge variant="outline">{`${labels.length} files`}</Badge>,
      cellClassName: 'whitespace-nowrap',
    };
  }

  if (fieldType === 'button') {
    const buttonField = field as ButtonField;
    const label = buttonField.label().toString();
    const count =
      typeof value === 'object' && value !== null && 'count' in value
        ? Number((value as { count?: unknown }).count)
        : resolveNumberValue(value);
    const text =
      typeof count === 'number' && Number.isFinite(count) ? `${label} (${count})` : label;
    return {
      text,
      node: <Badge variant="outline">{text}</Badge>,
      cellClassName: 'whitespace-nowrap',
    };
  }

  if (fieldType === 'link') {
    const linkField = field as LinkField;
    const values = linkField.isMultipleValue()
      ? Array.isArray(value)
        ? value
        : [value]
      : Array.isArray(value)
        ? value.slice(0, 1)
        : [value];
    const labels = values
      .map((entry) => resolveLinkLabel(entry))
      .filter((entry): entry is string => Boolean(entry));
    return formatBadgeListValue(labels, { variant: 'outline' });
  }

  if (fieldType === 'lookup') {
    const lookupField = field as LookupField;
    const values = Array.isArray(value) ? value : [value];
    const innerFieldResult = lookupField.innerField();
    if (innerFieldResult.isErr()) {
      const labels = values
        .map((entry) => stringifyRecordValue(entry))
        .filter((entry): entry is string => Boolean(entry));
      return formatBadgeListValue(labels, { variant: 'secondary' });
    }

    const innerField = innerFieldResult.value;
    const labels = values
      .map((entry) => {
        if (isEmptyRecordValue(entry)) return null;
        const formatted = formatRecordValue(innerField, entry);
        return formatted.text || stringifyRecordValue(entry);
      })
      .filter((entry): entry is string => Boolean(entry));
    return formatBadgeListValue(labels, { variant: 'secondary' });
  }

  if (fieldType === 'formula' || fieldType === 'rollup') {
    const computedField = field as FormulaField | RollupField;
    const valueTypeResult = computedField.cellValueType();
    if (valueTypeResult.isOk()) {
      const valueType = valueTypeResult.value.toString();
      const formatting = computedField.formatting();

      if (valueType === 'number') {
        const number = resolveNumberValue(value);
        if (number === null) return formatTextCellValue(stringifyRecordValue(value));
        if (formatting) {
          const dto = formatting.toDto();
          if ('precision' in dto) {
            return formatTextCellValue(
              formatNumberText(number, formatting as NumberFormatting),
              'text-right tabular-nums whitespace-nowrap'
            );
          }
        }
        return formatTextCellValue(number.toString(), 'text-right tabular-nums whitespace-nowrap');
      }

      if (valueType === 'dateTime' && formatting) {
        const dto = formatting.toDto();
        if ('date' in dto) {
          const formatted = formatDateTimeText(value, formatting as DateTimeFormatting);
          if (formatted)
            return formatTextCellValue(formatted, 'font-mono text-xs whitespace-nowrap');
        }
      }

      if (valueType === 'boolean') {
        return formatBooleanValue(value);
      }
    }

    return formatTextCellValue(stringifyRecordValue(value));
  }

  return formatTextCellValue(stringifyRecordValue(value));
};

const formatColumnMetaExtras = (entry: ViewColumnMetaValue[string]): string => {
  const knownKeys = new Set(['order', 'visible', 'hidden', 'required', 'width', 'statisticFunc']);
  const extra = Object.keys(entry).reduce<Record<string, unknown>>((acc, key) => {
    if (!knownKeys.has(key)) {
      acc[key] = entry[key];
    }
    return acc;
  }, {});

  if (!Object.keys(extra).length) return '-';
  return JSON.stringify(extra);
};

const getDbFieldName = (field: Field): string | null => {
  const nameResult = field.dbFieldName().andThen((name) => name.value());
  return nameResult.isOk() ? nameResult.value : null;
};

const getDbTableName = (table: TableAggregate): string | null => {
  const nameResult = table.dbTableName().andThen((name) => name.value());
  return nameResult.isOk() ? nameResult.value : null;
};

const tableTabValues = ['table', 'records', 'json', 'realtime'] as const;
type TableMetaTab = (typeof tableTabValues)[number];

const isTableMetaTab = (value: string): value is TableMetaTab =>
  tableTabValues.includes(value as TableMetaTab);

const shouldExpandJsonNode = (level: number) => level < 2;

const copyTableJson = async (
  table: TableAggregate,
  copyToClipboard: (value: string) => Promise<boolean>
) => {
  const tableDtoResult = mapTableToDto(table);
  if (tableDtoResult.isErr()) {
    toast.error('Unable to prepare table JSON', { description: tableDtoResult.error.message });
    return;
  }

  const didCopy = await copyToClipboard(JSON.stringify(tableDtoResult.value, null, 2));
  if (didCopy) {
    toast.success('Copied table JSON');
  } else {
    toast.error('Copy failed');
  }
};

type TableMetaPageProps = {
  baseId: string;
  tableId: string;
  table: TableAggregate | null;
  eventCount: number | null;
  realtimeSnapshot: ITablePersistenceDTO | null;
  realtimeStatus: ShareDbDocStatus;
  realtimeError: string | null;
  realtimeFieldSnapshots: ReadonlyArray<ITableFieldPersistenceDTO>;
  realtimeFieldStatus: ShareDbDocStatus;
  realtimeFieldError: string | null;
  isInitialLoading: boolean;
  isLoading: boolean;
  records: ReadonlyArray<ITableRecordDto> | null;
  recordsError: string | null;
  isRecordsLoading: boolean;
  isRecordsFetching: boolean;
  isCreating: boolean;
  isDeleting: boolean;
  isDeletingField: boolean;
  isRenaming: boolean;
  errorMessage: string | null;
  onRefresh: () => void;
  onFieldCreated: () => void;
  templates: ReadonlyArray<TableTemplateDefinition>;
  onCreateTemplate: (template: TableTemplateDefinition) => void;
  onDelete: () => void;
  onDeleteField: (fieldId: string) => void;
  onRename: (name: string) => void;
};

export function TableMetaPage({
  baseId,
  tableId,
  table,
  realtimeSnapshot,
  realtimeStatus,
  realtimeError,
  realtimeFieldSnapshots,
  realtimeFieldStatus,
  realtimeFieldError,
  isInitialLoading,
  isLoading,
  records,
  recordsError,
  isRecordsLoading,
  isRecordsFetching,
  isCreating,
  isDeleting,
  isDeletingField,
  isRenaming,
  errorMessage,
  onRefresh,
  onFieldCreated,
  templates,
  onCreateTemplate,
  onDelete,
  onDeleteField,
  onRename,
}: TableMetaPageProps) {
  const [activeTab, setActiveTab] = useQueryState(
    'tab',
    parseAsStringEnum<TableMetaTab>([...tableTabValues]).withDefault('table')
  );
  const tableDtoResult = useMemo(() => (table ? mapTableToDto(table) : null), [table]);
  const tableJson = tableDtoResult?.isOk() ? tableDtoResult.value : null;
  const tableJsonError = tableDtoResult?.isErr() ? tableDtoResult.error.message : null;

  const handleTabChange = (value: string) => {
    if (!isTableMetaTab(value)) return;
    void setActiveTab(value);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden h-full">
      <PlaygroundHeader
        baseId={baseId}
        table={table}
        isLoading={isLoading}
        isCreating={isCreating}
        isDeleting={isDeleting}
        isRenaming={isRenaming}
        onRefresh={onRefresh}
        onFieldCreated={onFieldCreated}
        templates={templates}
        onCreateTemplate={onCreateTemplate}
        onDelete={onDelete}
        onRename={onRename}
      />
      <ScrollArea className="flex-1 min-h-0" scrollHideDelay={0}>
        <section className="space-y-4 px-4 py-4">
          {errorMessage ? <PlaygroundErrorState message={errorMessage} /> : null}

          {isInitialLoading ? (
            <PlaygroundLoadingState />
          ) : !table ? (
            <PlaygroundEmptyState
              isCreating={isCreating}
              templates={templates}
              onCreateTemplate={onCreateTemplate}
            />
          ) : (
            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
              <TabsList className="h-8 w-fit p-0.5 bg-transparent border-none">
                <TabsTrigger
                  value="table"
                  className="h-7 text-xs px-3 data-[state=active]:bg-muted/50 data-[state=active]:shadow-none"
                >
                  Table
                </TabsTrigger>
                <TabsTrigger
                  value="records"
                  className="h-7 text-xs px-3 data-[state=active]:bg-muted/50 data-[state=active]:shadow-none"
                >
                  Records
                </TabsTrigger>
                <TabsTrigger
                  value="json"
                  className="h-7 text-xs px-3 data-[state=active]:bg-muted/50 data-[state=active]:shadow-none"
                >
                  JSON
                </TabsTrigger>
                <TabsTrigger
                  value="realtime"
                  className="h-7 text-xs px-3 data-[state=active]:bg-muted/50 data-[state=active]:shadow-none"
                >
                  Realtime
                </TabsTrigger>
              </TabsList>
              <TabsContent value="table" className="mt-0 outline-none">
                <PlaygroundMetaLayout
                  table={table}
                  baseId={baseId}
                  tableId={tableId}
                  isLoading={isLoading}
                  isDeletingField={isDeletingField}
                  onDeleteField={onDeleteField}
                />
              </TabsContent>
              <TabsContent value="records" className="mt-0 outline-none">
                <PlaygroundRecordsLayout
                  table={table}
                  records={records}
                  recordsError={recordsError}
                  isRecordsLoading={isRecordsLoading}
                  isRecordsFetching={isRecordsFetching}
                />
              </TabsContent>
              <TabsContent value="json" className="mt-0">
                <PlaygroundJsonLayout
                  table={table}
                  tableJson={tableJson}
                  tableJsonError={tableJsonError}
                />
              </TabsContent>
              <TabsContent value="realtime" className="mt-0">
                <PlaygroundRealtimeLayout
                  realtimeSnapshot={realtimeSnapshot}
                  realtimeStatus={realtimeStatus}
                  realtimeError={realtimeError}
                  realtimeFieldSnapshots={realtimeFieldSnapshots}
                  realtimeFieldStatus={realtimeFieldStatus}
                  realtimeFieldError={realtimeFieldError}
                />
              </TabsContent>
            </Tabs>
          )}
        </section>
      </ScrollArea>
    </div>
  );
}

type PlaygroundHeaderProps = {
  baseId: string;
  table: TableAggregate | null;
  isLoading: boolean;
  isCreating: boolean;
  isDeleting: boolean;
  isRenaming: boolean;
  onRefresh: () => void;
  onFieldCreated: () => void;
  templates: ReadonlyArray<TableTemplateDefinition>;
  onCreateTemplate: (template: TableTemplateDefinition) => void;
  onDelete: () => void;
  onRename: (name: string) => void;
};

function PlaygroundHeader({
  baseId,
  table,
  isLoading,
  isCreating,
  isDeleting,
  isRenaming,
  onRefresh,
  onFieldCreated,
  templates,
  onCreateTemplate,
  onDelete,
  onRename,
}: PlaygroundHeaderProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const canDelete = !!table && !isDeleting;
  const currentName = table ? table.name().toString() : '';
  const tableName = table ? table.name().toString() : 'Table';
  const fieldCount = table ? table.getFields().length : null;
  const trimmedRename = renameValue.trim();
  const canRename =
    !!table && trimmedRename.length > 0 && trimmedRename !== currentName && !isRenaming;
  const appBaseUrl = import.meta.env.VITE_APP_URL?.trim();
  const appTableUrl =
    table && appBaseUrl
      ? (() => {
          const resolvedTableId = table.id().toString();
          try {
            return new URL(`/base/${baseId}/table/${resolvedTableId}`, appBaseUrl).toString();
          } catch {
            return null;
          }
        })()
      : null;

  const handleDeleteConfirm = () => {
    if (!table) return;
    onDelete();
    setDeleteOpen(false);
  };

  const handleRenameConfirm = () => {
    if (!table) return;
    if (!canRename) return;
    onRename(trimmedRename);
    setRenameOpen(false);
  };

  useEffect(() => {
    if (!renameOpen) return;
    if (!table) return;
    setRenameValue(table.name().toString());
  }, [renameOpen, table]);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <div className="h-4 w-px bg-border mx-1" />
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <TableIcon className="h-4 w-4 text-muted-foreground" />
          <span>{tableName}</span>
          {appTableUrl ? (
            <Button variant="ghost" size="icon-sm" className="h-6 w-6" asChild>
              <a href={appTableUrl} target="_blank" rel="noreferrer" title="Open in App">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null}
        </div>
        <div className="ml-2 flex items-center gap-1.5">
          {fieldCount !== null ? (
            <Badge
              variant="secondary"
              className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
            >
              {fieldCount} fields
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs font-normal"
          disabled={!table || isLoading}
          onClick={onRefresh}
        >
          <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
        {table && (
          <FieldCreateDialog
            baseId={baseId}
            tableId={table.id().toString()}
            onSuccess={onFieldCreated}
          />
        )}
        <CreateTableDropdown
          templates={templates}
          isCreating={isCreating}
          onSelect={onCreateTemplate}
          label="Create table"
          align="end"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8"
              aria-label="Table actions"
              disabled={!table}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              disabled={!table || isRenaming}
              className="text-xs py-1.5"
              onSelect={(event) => {
                event.preventDefault();
                setRenameOpen(true);
              }}
            >
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Rename table
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs py-1.5 text-destructive focus:text-destructive"
              disabled={!canDelete}
              onSelect={(event) => {
                event.preventDefault();
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Delete table
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete table</AlertDialogTitle>
            <AlertDialogDescription>
              {table
                ? `Delete "${table.name().toString()}"? This will remove its schema and metadata.`
                : 'Delete this table?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={renameOpen} onOpenChange={setRenameOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Rename table</AlertDialogTitle>
            <AlertDialogDescription>
              Choose a new name for this table. Names must be between 1 and 255 characters.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              maxLength={255}
              placeholder="Table name"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRenaming}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRenameConfirm} disabled={!canRename}>
              {isRenaming ? 'Renaming...' : 'Rename'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}

type PlaygroundErrorStateProps = {
  message: string;
};

function PlaygroundErrorState({ message }: PlaygroundErrorStateProps) {
  return (
    <Card className="border-destructive/40 bg-destructive/10">
      <CardHeader className="flex flex-row items-center gap-3">
        <TriangleAlert className="h-4 w-4 text-destructive" />
        <CardTitle className="text-base text-destructive">{message}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function PlaygroundLoadingState() {
  return (
    <div className="space-y-3 min-w-0">
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`header-skeleton-${index}`} className="h-4 w-full" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, rowIndex) => (
            <div key={`row-skeleton-${rowIndex}`} className="grid grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, colIndex) => (
                <Skeleton key={`cell-skeleton-${rowIndex}-${colIndex}`} className="h-4 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type PlaygroundEmptyStateProps = {
  isCreating: boolean;
  templates: ReadonlyArray<TableTemplateDefinition>;
  onCreateTemplate: (template: TableTemplateDefinition) => void;
};

function PlaygroundEmptyState({
  isCreating,
  templates,
  onCreateTemplate,
}: PlaygroundEmptyStateProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Build a table in seconds</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>
          This playground uses Teable v2 core with a fixed actor. Pick a template to create a table,
          view its schema, or switch the base ID from the sidebar.
        </p>
        <CreateTableDropdown
          templates={templates}
          isCreating={isCreating}
          onSelect={onCreateTemplate}
          label="Create table"
          align="start"
        />
      </CardContent>
    </Card>
  );
}

type PlaygroundMetaLayoutProps = {
  table: TableAggregate;
  baseId: string;
  tableId: string;
  isLoading: boolean;
  isDeletingField: boolean;
  onDeleteField: (fieldId: string) => void;
};

function PlaygroundMetaLayout({
  table,
  baseId,
  tableId,
  isLoading,
  isDeletingField,
  onDeleteField,
}: PlaygroundMetaLayoutProps) {
  return (
    <div className="space-y-6 min-w-0">
      <TableSchemaCard
        table={table}
        isDeletingField={isDeletingField}
        onDeleteField={onDeleteField}
      />
      <TableViewsCard views={table.views()} />
      <TableConnectionCard baseId={baseId} tableId={tableId} table={table} isLoading={isLoading} />
    </div>
  );
}

type PlaygroundRecordsLayoutProps = {
  table: TableAggregate;
  records: ReadonlyArray<ITableRecordDto> | null;
  recordsError: string | null;
  isRecordsLoading: boolean;
  isRecordsFetching: boolean;
};

function PlaygroundRecordsLayout({
  table,
  records,
  recordsError,
  isRecordsLoading,
  isRecordsFetching,
}: PlaygroundRecordsLayoutProps) {
  return (
    <div className="space-y-6 min-w-0">
      <TableRecordsCard
        table={table}
        records={records}
        recordsError={recordsError}
        isRecordsLoading={isRecordsLoading}
        isRecordsFetching={isRecordsFetching}
      />
    </div>
  );
}

type PlaygroundJsonLayoutProps = {
  table: TableAggregate;
  tableJson: ITableDto | null;
  tableJsonError: string | null;
};

function PlaygroundJsonLayout({ table, tableJson, tableJsonError }: PlaygroundJsonLayoutProps) {
  return (
    <div className="space-y-6 min-w-0">
      <TableJsonCard table={table} tableJson={tableJson} tableJsonError={tableJsonError} />
    </div>
  );
}

type PlaygroundRealtimeLayoutProps = {
  realtimeSnapshot: ITablePersistenceDTO | null;
  realtimeStatus: ShareDbDocStatus;
  realtimeError: string | null;
  realtimeFieldSnapshots: ReadonlyArray<ITableFieldPersistenceDTO>;
  realtimeFieldStatus: ShareDbDocStatus;
  realtimeFieldError: string | null;
};

function PlaygroundRealtimeLayout({
  realtimeSnapshot,
  realtimeStatus,
  realtimeError,
  realtimeFieldSnapshots,
  realtimeFieldStatus,
  realtimeFieldError,
}: PlaygroundRealtimeLayoutProps) {
  return (
    <div className="space-y-6 min-w-0">
      <RealtimeSnapshotCard
        snapshot={realtimeSnapshot}
        status={realtimeStatus}
        error={realtimeError}
        title="ShareDB Table Snapshot"
      />
      <RealtimeFieldsCard
        snapshots={realtimeFieldSnapshots}
        status={realtimeFieldStatus}
        error={realtimeFieldError}
      />
    </div>
  );
}

type TableSchemaCardProps = {
  table: TableAggregate;
  isDeletingField: boolean;
  onDeleteField: (fieldId: string) => void;
};

function TableSchemaCard({ table, isDeletingField, onDeleteField }: TableSchemaCardProps) {
  const fields = table.getFields();
  const primaryFieldId = table.primaryFieldId();
  const [, copyToClipboard] = useCopyToClipboard();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Field | null>(null);
  const canDeleteField = !!deleteTarget && !isDeletingField;
  const handleCopyTableJson = () => {
    void copyTableJson(table, copyToClipboard);
  };
  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    onDeleteField(deleteTarget.id().toString());
    setDeleteOpen(false);
  };
  const deleteFieldLabel = deleteTarget ? deleteTarget.name().toString() : 'this field';

  return (
    <section className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <TableIcon className="h-4 w-4 text-muted-foreground" />
          {table.name().toString()}
          <Badge
            variant="secondary"
            className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
          >
            {fields.length} fields
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs font-normal"
          onClick={handleCopyTableJson}
        >
          <Copy className="h-3.5 w-3.5" />
          Copy JSON
        </Button>
      </div>
      <div className="overflow-auto rounded-md border border-border/60">
        <UITable>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Field ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>DB Field</TableHead>
              <TableHead>Info</TableHead>
              <TableHead>Options</TableHead>
              <TableHead className="w-12 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field) => {
              const dbFieldName = getDbFieldName(field);
              const isPrimary = field.id().equals(primaryFieldId);
              const disableDelete = isPrimary || isDeletingField;
              return (
                <TableRow key={field.id().toString()}>
                  <TableCell className="font-medium">{field.name().toString()}</TableCell>
                  <TableCell className="break-all font-mono text-xs text-muted-foreground">
                    {field.id().toString()}
                  </TableCell>
                  <TableCell>{field.type().toString()}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {dbFieldName ?? '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {isPrimary ? <Badge variant="outline">Primary</Badge> : null}
                      {field.type().toString() === 'lookup' ? (
                        <Badge variant="secondary">Lookup</Badge>
                      ) : null}
                      {!isPrimary && field.type().toString() !== 'lookup' ? (
                        <span className="text-xs text-muted-foreground">-</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{renderFieldOptions(field)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-7 w-7"
                      aria-label={`Delete ${field.name().toString()}`}
                      disabled={disableDelete}
                      onClick={() => {
                        setDeleteTarget(field);
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </UITable>
      </div>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete field</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{deleteFieldLabel}&quot;? This will remove its schema and metadata.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingField}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60"
              onClick={handleDeleteConfirm}
              disabled={!canDeleteField}
            >
              {isDeletingField ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

type TableRecordsCardProps = {
  table: TableAggregate;
  records: ReadonlyArray<ITableRecordDto> | null;
  recordsError: string | null;
  isRecordsLoading: boolean;
  isRecordsFetching: boolean;
};

function TableRecordsCard({
  table,
  records,
  recordsError,
  isRecordsLoading,
  isRecordsFetching,
}: TableRecordsCardProps) {
  const fields = table.getFields();
  const recordCount = records?.length ?? 0;
  const isInitialLoading = isRecordsLoading && !records;

  const columns = useMemo<ColumnDef<ITableRecordDto>[]>(() => {
    const idColumn: ColumnDef<ITableRecordDto> = {
      accessorKey: 'id',
      header: 'Record ID',
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
          {row.original.id}
        </span>
      ),
    };

    const fieldColumns: ColumnDef<ITableRecordDto>[] = fields.map((field) => ({
      id: field.id().toString(),
      header: field.name().toString(),
      cell: ({ row }) => {
        const value = row.original.fields[field.id().toString()];
        const formattedValue = formatRecordValue(field, value);
        return (
          <div
            className={cn('max-w-[240px]', formattedValue.cellClassName)}
            title={formattedValue.text}
          >
            {formattedValue.node}
          </div>
        );
      },
    }));

    return [idColumn, ...fieldColumns];
  }, [fields]);

  const data = useMemo(() => (records ?? []) as ITableRecordDto[], [records]);

  const caption =
    recordCount === 0
      ? 'No records yet.'
      : `${recordCount} record${recordCount === 1 ? '' : 's'} loaded.`;

  return (
    <section className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <TableIcon className="h-4 w-4 text-muted-foreground" />
        Records
        <Badge
          variant="secondary"
          className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
        >
          {recordCount} records
        </Badge>
        {isRecordsFetching ? (
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
          >
            Loading
          </Badge>
        ) : null}
      </div>
      {recordsError ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <TriangleAlert className="h-4 w-4" />
          <span>{recordsError}</span>
        </div>
      ) : isInitialLoading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={`record-header-skeleton-${index}`} className="h-4 w-full" />
            ))}
          </div>
          {Array.from({ length: 4 }).map((_, rowIndex) => (
            <div key={`record-row-skeleton-${rowIndex}`} className="grid grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, colIndex) => (
                <Skeleton
                  key={`record-cell-skeleton-${rowIndex}-${colIndex}`}
                  className="h-4 w-full"
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <DataTable columns={columns} data={data} emptyMessage="No records yet." caption={caption} />
      )}
    </section>
  );
}

type TableJsonCardProps = {
  table: TableAggregate;
  tableJson: ITableDto | null;
  tableJsonError: string | null;
};

function TableJsonCard({ table, tableJson, tableJsonError }: TableJsonCardProps) {
  const [, copyToClipboard] = useCopyToClipboard();
  const handleCopyTableJson = () => {
    void copyTableJson(table, copyToClipboard);
  };

  return (
    <section className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <FileJson className="h-4 w-4 text-muted-foreground" />
          Table JSON
          <Badge
            variant="secondary"
            className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
          >
            {table.getFields().length} fields
          </Badge>
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
          >
            {table.views().length} views
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs font-normal"
          onClick={handleCopyTableJson}
        >
          <Copy className="h-3.5 w-3.5" />
          Copy JSON
        </Button>
      </div>
      <div className="overflow-hidden rounded-md border border-border/60">
        {tableJsonError ? (
          <div className="px-6 py-4 text-sm text-destructive">
            Unable to render JSON: {tableJsonError}
          </div>
        ) : !tableJson ? (
          <div className="px-6 py-4 text-sm text-muted-foreground">JSON snapshot unavailable.</div>
        ) : (
          <ScrollArea className="h-[60vh] min-h-[320px]">
            <div className="px-6 pb-6 pt-4 text-xs font-mono text-foreground">
              <JsonView
                data={tableJson}
                shouldExpandNode={shouldExpandJsonNode}
                clickToExpandNode
              />
            </div>
          </ScrollArea>
        )}
      </div>
    </section>
  );
}

type RealtimeSnapshotCardProps = {
  snapshot: unknown;
  status: ShareDbDocStatus;
  error: string | null;
  title: string;
};

const formatRealtimeStatusLabel = (status: ShareDbDocStatus): string => {
  if (status === 'ready') return 'Live';
  if (status === 'connecting') return 'Connecting';
  if (status === 'error') return 'Error';
  return 'Idle';
};

const resolveRealtimeStatusVariant = (
  status: ShareDbDocStatus
): 'secondary' | 'outline' | 'destructive' => {
  if (status === 'ready') return 'secondary';
  if (status === 'error') return 'destructive';
  return 'outline';
};

function RealtimeSnapshotCard({ snapshot, status, error, title }: RealtimeSnapshotCardProps) {
  const statusLabel = formatRealtimeStatusLabel(status);
  const statusVariant = resolveRealtimeStatusVariant(status);

  return (
    <section className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <FileJson className="h-4 w-4 text-muted-foreground" />
        {title}
        <Badge
          variant={statusVariant}
          className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
        >
          {statusLabel}
        </Badge>
      </div>
      <div className="overflow-hidden rounded-md border border-border/60">
        {error ? (
          <div className="px-6 py-4 text-sm text-destructive">Realtime error: {error}</div>
        ) : !snapshot ? (
          <div className="px-6 py-4 text-sm text-muted-foreground">
            Waiting for ShareDB snapshot.
          </div>
        ) : (
          <ScrollArea className="h-[60vh] min-h-[320px]">
            <div className="px-6 pb-6 pt-4 text-xs font-mono text-foreground">
              <JsonView data={snapshot} shouldExpandNode={shouldExpandJsonNode} clickToExpandNode />
            </div>
          </ScrollArea>
        )}
      </div>
    </section>
  );
}

type RealtimeFieldsCardProps = {
  snapshots: ReadonlyArray<ITableFieldPersistenceDTO>;
  status: ShareDbDocStatus;
  error: string | null;
};

function RealtimeFieldsCard({ snapshots, status, error }: RealtimeFieldsCardProps) {
  return (
    <RealtimeSnapshotCard
      snapshot={snapshots}
      status={status}
      error={error}
      title="ShareDB Field Query"
    />
  );
}

type TableViewsCardProps = {
  views: ReadonlyArray<View>;
};

function TableViewsCard({ views }: TableViewsCardProps) {
  const viewLabels = views.map(formatViewLabel);
  const viewDetails = views.map((view) => {
    const columnMetaResult = getViewColumnMeta(view);
    const columnMetaEntries = columnMetaResult.value ? sortColumnMeta(columnMetaResult.value) : [];
    const hasVisibility = columnMetaEntries.some(
      ([, entry]) => entry.visible !== undefined || entry.hidden !== undefined
    );
    return {
      view,
      columnMetaEntries,
      columnMetaError: columnMetaResult.error,
      columnMetaCount: columnMetaEntries.length,
      hasVisibility,
    };
  });

  return (
    <section className="space-y-3 min-w-0">
      <div className="text-sm font-semibold">Views</div>
      <div className="space-y-4">
        {viewLabels.length ? (
          <>
            <div className="flex flex-wrap gap-2">
              {viewLabels.map((viewLabel) => (
                <Badge key={viewLabel} variant="secondary">
                  {viewLabel}
                </Badge>
              ))}
            </div>
            <div className="space-y-3">
              {viewDetails.map(
                ({ view, columnMetaEntries, columnMetaError, columnMetaCount, hasVisibility }) => (
                  <div
                    key={view.id().toString()}
                    className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-foreground">
                        {view.name().toString()}
                      </div>
                      <Badge variant="secondary">{view.type().toString()}</Badge>
                      <Badge variant="outline">{columnMetaCount} columns</Badge>
                      {hasVisibility ? <Badge variant="outline">visibility</Badge> : null}
                      {columnMetaError ? (
                        <Badge variant="destructive">column meta error</Badge>
                      ) : null}
                    </div>
                    {columnMetaError ? (
                      <div className="text-xs text-destructive">{columnMetaError}</div>
                    ) : null}
                    {columnMetaEntries.length ? (
                      <UITable>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Field ID</TableHead>
                            <TableHead>Order</TableHead>
                            <TableHead>Visible</TableHead>
                            <TableHead>Hidden</TableHead>
                            <TableHead>Required</TableHead>
                            <TableHead>Width</TableHead>
                            <TableHead>Statistic</TableHead>
                            <TableHead>Extras</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {columnMetaEntries.map(([fieldId, entry]) => (
                            <TableRow key={`${view.id().toString()}-${fieldId}`}>
                              <TableCell className="break-all font-mono text-xs text-muted-foreground">
                                {fieldId}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {formatOptionalNumber(entry.order)}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {formatOptionalBoolean(entry.visible)}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {formatOptionalBoolean(entry.hidden)}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {formatOptionalBoolean(entry.required)}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {formatOptionalNumber(entry.width)}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {formatOptionalString(entry.statisticFunc)}
                              </TableCell>
                              <TableCell className="break-all font-mono text-xs text-muted-foreground">
                                {formatColumnMetaExtras(entry)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </UITable>
                    ) : (
                      <div className="text-xs text-muted-foreground">No column meta entries.</div>
                    )}
                  </div>
                )
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">No views defined.</div>
        )}
      </div>
    </section>
  );
}

type TableConnectionCardProps = {
  baseId: string;
  tableId: string;
  table: TableAggregate;
  isLoading: boolean;
};

function TableConnectionCard({ baseId, tableId, table, isLoading }: TableConnectionCardProps) {
  const dbTableName = getDbTableName(table);
  const tableIdValue = table.id().toString();
  const baseIdValue = table.baseId().toString();
  const resolvedTableId = tableIdValue || tableId;

  return (
    <section className="space-y-3 min-w-0">
      <div className="text-sm font-semibold">Connection</div>
      <div className="space-y-2 text-xs text-muted-foreground">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span>Base ID</span>
          <code className="break-all text-[11px] text-foreground font-mono sm:text-right">
            {baseIdValue || baseId}
          </code>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span>Table ID</span>
          <code className="break-all text-[11px] text-foreground font-mono sm:text-right">
            {resolvedTableId}
          </code>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span>DB Table</span>
          <code className="break-all text-[11px] text-foreground font-mono sm:text-right">
            {dbTableName ?? '-'}
          </code>
        </div>
        <div className="flex items-center justify-between">
          <span>Status</span>
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
          >
            {isLoading ? 'loading' : 'ready'}
          </Badge>
        </div>
      </div>
    </section>
  );
}
