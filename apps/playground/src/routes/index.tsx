import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  Database,
  LayoutGrid,
  Plus,
  RefreshCcw,
  Table as TableIcon,
  TriangleAlert,
} from 'lucide-react';
import type {
  ICreateTableRequestDto,
  IFieldDto,
  ITableDto,
  IViewDto,
} from '@teable/v2-contract-http';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getOrpcClient } from '@/lib/orpcClient';
import {
  PLAYGROUND_BASE_ID,
  PLAYGROUND_BASE_NAME,
  PLAYGROUND_TABLE_ID_STORAGE_KEY,
} from '@/lib/playground/constants';

export const Route = createFileRoute('/')({ component: Playground });

const fallbackTimeZone = 'utc';
const fieldColors = ['blue', 'green', 'yellow'] as const;
const ratingIcon = 'star' as const;
const ratingColor = 'yellowBright' as const;

const basicTableInput: ICreateTableRequestDto = {
  baseId: PLAYGROUND_BASE_ID,
  name: 'All Fields',
  fields: [
    {
      type: 'singleLineText',
      name: 'Name',
      options: { showAs: { type: 'email' }, defaultValue: 'owner@example.com' },
    },
    { type: 'longText', name: 'Description', options: { defaultValue: 'Details' } },
    {
      type: 'number',
      name: 'Amount',
      options: {
        formatting: { type: 'currency', precision: 2, symbol: '$' },
        showAs: { type: 'bar', color: 'teal', showValue: true, maxValue: 100 },
        defaultValue: 10,
      },
    },
    {
      type: 'rating',
      name: 'Priority',
      options: { max: 5, icon: 'star', color: 'yellowBright' },
    },
    {
      type: 'singleSelect',
      name: 'Status',
      options: {
        choices: [
          { name: 'Todo', color: 'blue' },
          { name: 'Doing', color: 'yellow' },
          { name: 'Done', color: 'green' },
        ],
        defaultValue: 'Todo',
        preventAutoNewOptions: true,
      },
    },
    {
      type: 'multipleSelect',
      name: 'Tags',
      options: {
        choices: [
          { name: 'Frontend', color: 'purple' },
          { name: 'Backend', color: 'orange' },
          { name: 'Bug', color: 'red' },
        ],
        defaultValue: ['Frontend', 'Bug'],
      },
    },
    { type: 'checkbox', name: 'Done', options: { defaultValue: true } },
    { type: 'attachment', name: 'Files' },
    {
      type: 'date',
      name: 'Due Date',
      options: {
        formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
        defaultValue: 'now',
      },
    },
    {
      type: 'user',
      name: 'Owner',
      options: { isMultiple: true, shouldNotify: false, defaultValue: ['me'] },
    },
    {
      type: 'button',
      name: 'Action',
      options: {
        label: 'Run',
        color: 'teal',
        maxCount: 3,
        resetCount: true,
        workflow: { id: 'wflaaaaaaaaaaaaaaaa', name: 'Deploy', isActive: true },
      },
    },
  ],
} as const;

const fieldTypeLabels: Record<IFieldDto['type'], string> = {
  singleLineText: 'Single line text',
  longText: 'Long text',
  number: 'Number',
  rating: 'Rating',
  singleSelect: 'Single select',
  multipleSelect: 'Multiple select',
  checkbox: 'Checkbox',
  attachment: 'Attachment',
  date: 'Date',
  user: 'User',
  button: 'Button',
};

const formatFieldOptions = (field: IFieldDto): string => {
  switch (field.type) {
    case 'number': {
      const formatting = field.options?.formatting;
      if (!formatting) return 'decimal';
      if (formatting.type === 'currency') {
        return `currency ${formatting.symbol} (p${formatting.precision})`;
      }
      if (formatting.type === 'percent') {
        return `percent (p${formatting.precision})`;
      }
      return `decimal (p${formatting.precision})`;
    }
    case 'rating': {
      const max = field.options?.max;
      return max ? `max ${max}` : 'max 5';
    }
    case 'singleSelect':
    case 'multipleSelect': {
      const choiceCount = field.options?.choices?.length ?? 0;
      return `${choiceCount} choices`;
    }
    case 'checkbox': {
      const defaultValue = field.options?.defaultValue;
      return defaultValue === undefined ? 'unchecked' : `default ${defaultValue}`;
    }
    case 'date': {
      const formatting = field.options?.formatting;
      if (!formatting) return 'date only';
      return `${formatting.time.toLowerCase()} ${formatting.timeZone}`;
    }
    case 'user': {
      if (!field.options) return 'single';
      return field.options.isMultiple ? 'multiple' : 'single';
    }
    case 'button': {
      const label = field.options?.label ?? 'Run';
      const max = field.options?.maxCount;
      return max ? `${label} (max ${max})` : label;
    }
    case 'singleLineText':
    case 'longText':
    case 'attachment':
    default:
      return '-';
  }
};

const formatViewLabel = (view: IViewDto): string => `${view.name} (${view.type})`;

function Playground() {
  const [table, setTable] = useState<ITableDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState<number | null>(null);

  const loadTable = async (tableId: string, silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const client = getOrpcClient();
      const response = await client.tables.getById({
        baseId: PLAYGROUND_BASE_ID,
        tableId,
      });
      setTable(response.data.table);
      localStorage.setItem(PLAYGROUND_TABLE_ID_STORAGE_KEY, tableId);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load table';
      setError(message);
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const client = getOrpcClient();
      const response = await client.tables.create({
        ...basicTableInput,
        name: `Playground Table ${Date.now()}`,
      });
      const created = response.data.table;
      setEventCount(response.data.events.length);
      await loadTable(created.id, true);
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Failed to create table';
      setError(message);
    } finally {
      setIsCreating(false);
    }
  };

  useEffect(() => {
    const storedTableId = localStorage.getItem(PLAYGROUND_TABLE_ID_STORAGE_KEY);
    if (storedTableId) {
      void loadTable(storedTableId);
    }
  }, []);

  const hasTable = Boolean(table);
  const viewLabels = table?.views.map(formatViewLabel) ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="w-72 shrink-0 border-r border-border bg-background">
          <div className="p-5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <LayoutGrid className="h-4 w-4" />
              Tables
            </div>
            <div className="mt-4">
              <Input placeholder="Search tables" disabled aria-label="Search tables" />
            </div>
          </div>
          <Separator />
          <ScrollArea className="h-[calc(100vh-170px)] px-4 pb-6">
            <div className="mt-4 space-y-3">
              {hasTable ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-left text-sm transition hover:bg-muted/50"
                >
                  <TableIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate font-medium">{table?.name}</span>
                  <Badge variant="secondary">{table?.fields.length}</Badge>
                </button>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No tables yet. Create your first one.
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background px-6 py-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Base
              </div>
              <div className="text-xl font-semibold text-foreground">{PLAYGROUND_BASE_NAME}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span>Postgres playground</span>
                {eventCount !== null ? <Badge variant="outline">events {eventCount}</Badge> : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                disabled={!table || isLoading}
                onClick={() => (table ? void loadTable(table.id) : undefined)}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              <Button disabled={isCreating} onClick={handleCreate}>
                <Plus className="mr-2 h-4 w-4" />
                {isCreating ? 'Creating...' : 'Create basic table'}
              </Button>
            </div>
          </header>

          <main className="flex-1 space-y-6 px-6 py-8">
            {error ? (
              <Card className="border-destructive/40 bg-destructive/10">
                <CardHeader className="flex flex-row items-center gap-3">
                  <TriangleAlert className="h-4 w-4 text-destructive" />
                  <CardTitle className="text-base text-destructive">{error}</CardTitle>
                </CardHeader>
              </Card>
            ) : null}

            {!hasTable ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Build a table in seconds</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-muted-foreground">
                  <p>
                    This playground uses Teable v2 core with a fixed base and user. Click the button
                    to create a table with all basic field types, then view its schema immediately.
                  </p>
                  <Button disabled={isCreating} onClick={handleCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    {isCreating ? 'Creating...' : 'Create table'}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-lg">
                      <TableIcon className="h-5 w-5 text-muted-foreground" />
                      {table?.name}
                      <Badge variant="secondary">{table?.fields.length} fields</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>DB Field</TableHead>
                          <TableHead>Primary</TableHead>
                          <TableHead>Options</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {table?.fields.map((field) => (
                          <TableRow key={field.id}>
                            <TableCell className="font-medium">{field.name}</TableCell>
                            <TableCell>{fieldTypeLabels[field.type]}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {field.dbFieldName ?? '-'}
                            </TableCell>
                            <TableCell>
                              {field.isPrimary ? (
                                <Badge variant="outline">Primary</Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {formatFieldOptions(field)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Views</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {viewLabels.length ? (
                        <div className="flex flex-wrap gap-2">
                          {viewLabels.map((viewLabel) => (
                            <Badge key={viewLabel} variant="secondary">
                              {viewLabel}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">No views defined.</div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Connection</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span>Base ID</span>
                        <code className="text-xs text-foreground">{PLAYGROUND_BASE_ID}</code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Table ID</span>
                        <code className="text-xs text-foreground">{table?.id}</code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>DB Table</span>
                        <code className="text-xs text-foreground">{table?.dbTableName ?? '-'}</code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Status</span>
                        <Badge variant="outline">{isLoading ? 'loading' : 'ready'}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
