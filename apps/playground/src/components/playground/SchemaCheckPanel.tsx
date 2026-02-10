import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  PLAYGROUND_DB_URL_QUERY_PARAM,
  resolvePlaygroundDbUrl,
} from '@/lib/playground/databaseUrl';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Play,
  RefreshCcw,
  Clock,
  ChevronRight,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LinkFieldLabel } from '@/components/playground/LinkFieldLabel';
import { getFieldTypeIcon } from '@/lib/fieldTypeIcons';
import { cn } from '@/lib/utils';

export type SchemaCheckStatus = 'success' | 'error' | 'warn' | 'pending' | 'running';

export interface SchemaCheckResult {
  id: string;
  fieldId: string;
  fieldName: string;
  ruleId: string;
  ruleDescription: string;
  status: SchemaCheckStatus;
  message?: string;
  details?: {
    missing?: ReadonlyArray<string>;
    extra?: ReadonlyArray<string>;
  };
  required: boolean;
  timestamp: number;
  /** IDs of rules this rule depends on */
  dependencies?: ReadonlyArray<string>;
  /** Nesting depth (0 = root, 1+ = nested) */
  depth?: number;
}

type FieldMeta = {
  id: string;
  name: string;
  type: string;
  relationship?: string;
  isOneWay?: boolean;
};

type SchemaCheckPanelProps = {
  tableId: string;
  tableName: string;
  fields?: ReadonlyArray<FieldMeta>;
};

const StatusIcon = ({ status }: { status: SchemaCheckStatus }) => {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'warn':
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case 'running':
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case 'pending':
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
};

const StatusBadge = ({ status }: { status: SchemaCheckStatus }) => {
  const variants: Record<SchemaCheckStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    success: 'secondary',
    error: 'destructive',
    warn: 'outline',
    running: 'default',
    pending: 'outline',
  };

  const labels: Record<SchemaCheckStatus, string> = {
    success: 'Pass',
    error: 'Fatal',
    warn: 'Warning',
    running: 'Running',
    pending: 'Pending',
  };

  return (
    <Badge variant={variants[status]} className="h-5 px-1.5 text-[10px] font-normal uppercase">
      {labels[status]}
    </Badge>
  );
};

/**
 * Renders a single rule result with appropriate indentation based on depth.
 */
const RuleResultItem = ({ result }: { result: SchemaCheckResult }) => {
  const depth = result.depth ?? 0;
  const hasParent = depth > 0;

  return (
    <div
      className={cn(
        'flex items-start gap-2 text-xs rounded-md p-2',
        result.status === 'error'
          ? 'bg-destructive/10'
          : result.status === 'warn'
            ? 'bg-yellow-500/10'
            : result.status === 'success'
              ? 'bg-green-500/10'
              : 'bg-muted/40'
      )}
      style={{ marginLeft: `${depth * 16}px` }}
    >
      {hasParent && <ChevronRight className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />}
      <StatusIcon status={result.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('font-medium', hasParent && 'text-muted-foreground')}>
            {result.ruleDescription}
          </span>
          <StatusBadge status={result.status} />
          {!result.required && (
            <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal uppercase">
              Optional
            </Badge>
          )}
        </div>
        {result.message && result.message !== 'Schema is valid' && (
          <div
            className={cn(
              'mt-1',
              result.status === 'error'
                ? 'text-destructive'
                : result.status === 'warn'
                  ? 'text-yellow-600 dark:text-yellow-400'
                  : 'text-muted-foreground'
            )}
          >
            {result.message}
          </div>
        )}
        {result.details?.missing && result.details.missing.length > 0 && (
          <div className="mt-1 text-destructive text-[11px]">
            Missing: {result.details.missing.join(', ')}
          </div>
        )}
        {result.details?.extra && result.details.extra.length > 0 && (
          <div className="mt-1 text-yellow-600 dark:text-yellow-400 text-[11px]">
            Extra: {result.details.extra.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
};

export function SchemaCheckPanel({ tableId, tableName, fields }: SchemaCheckPanelProps) {
  const [results, setResults] = useState<SchemaCheckResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fieldMetaById = useMemo(() => {
    return (fields ?? []).reduce<Record<string, FieldMeta>>((acc, field) => {
      acc[field.id] = field;
      return acc;
    }, {});
  }, [fields]);

  const stopCheck = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsRunning(false);
  }, []);

  const startCheck = useCallback(() => {
    stopCheck();
    setResults([]);
    setIsRunning(true);
    setHasRun(true);

    const dbUrl = resolvePlaygroundDbUrl();
    const baseUrl = `/api/schema/${tableId}/check/stream`;
    const eventSourceUrl = dbUrl
      ? `${baseUrl}?${new URLSearchParams({
          [PLAYGROUND_DB_URL_QUERY_PARAM]: dbUrl,
        }).toString()}`
      : baseUrl;
    const eventSource = new EventSource(eventSourceUrl);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const result = JSON.parse(event.data) as SchemaCheckResult;

        // Skip connection and completion messages for display
        if (result.id === 'connect') {
          return;
        }

        if (result.id === 'complete') {
          setIsRunning(false);
          eventSource.close();
          return;
        }

        setResults((prev) => {
          // If running status, update existing or add new
          if (result.status === 'running') {
            const existingIndex = prev.findIndex((r) => r.id === result.id);
            if (existingIndex >= 0) {
              const updated = [...prev];
              updated[existingIndex] = result;
              return updated;
            }
            return [...prev, result];
          }

          // For final status, update the existing running entry
          const existingIndex = prev.findIndex((r) => r.id === result.id);
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = result;
            return updated;
          }

          return [...prev, result];
        });
      } catch (e) {
        console.error('Failed to parse SSE message:', e);
      }
    };

    eventSource.onerror = () => {
      setIsRunning(false);
      eventSource.close();
    };
  }, [tableId, stopCheck]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Auto-start when tableId changes or on mount
  const hasStartedRef = useRef(false);
  useEffect(() => {
    hasStartedRef.current = false;
    setResults([]);
    setHasRun(false);
    stopCheck();
  }, [tableId, stopCheck]);

  useEffect(() => {
    // Auto-start the check when entering the tab (only once per tableId)
    if (!hasStartedRef.current && !isRunning && !hasRun) {
      hasStartedRef.current = true;
      const timer = setTimeout(() => {
        startCheck();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [tableId, isRunning, hasRun, startCheck]);

  // Group results by field
  const groupedResults = results.reduce<Record<string, SchemaCheckResult[]>>((acc, result) => {
    const key = result.fieldId || 'system';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(result);
    return acc;
  }, {});

  // Summary counts
  const summary = {
    total: results.filter((r) => r.status !== 'running').length,
    success: results.filter((r) => r.status === 'success').length,
    error: results.filter((r) => r.status === 'error').length,
    warn: results.filter((r) => r.status === 'warn').length,
    running: results.filter((r) => r.status === 'running').length,
  };

  return (
    <section className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          Schema Check
          {hasRun && (
            <>
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
              >
                {summary.total} checks
              </Badge>
              {summary.success > 0 && (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider text-green-600"
                >
                  ✓ {summary.success}
                </Badge>
              )}
              {summary.error > 0 && (
                <Badge
                  variant="destructive"
                  className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
                >
                  ✗ {summary.error}
                </Badge>
              )}
              {summary.warn > 0 && (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider text-yellow-600"
                >
                  ⚠ {summary.warn}
                </Badge>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isRunning ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-normal"
              onClick={stopCheck}
            >
              <XCircle className="mr-1.5 h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-normal"
              onClick={startCheck}
            >
              {hasRun ? (
                <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {hasRun ? 'Re-check' : 'Start Check'}
            </Button>
          )}
        </div>
      </div>

      {!hasRun ? (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-6 text-center">
          <div className="text-sm text-muted-foreground">
            Click "Start Check" to validate the schema for table{' '}
            <span className="font-medium text-foreground">{tableName}</span>.
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            This will check all field rules including columns, indexes, foreign keys, and more.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedResults).map(([fieldId, fieldResults]) => {
            const isSystemField = fieldId === 'system';
            const fieldMeta = fieldMetaById[fieldId];
            const fieldName =
              fieldMeta?.name || fieldResults[0]?.fieldName || (isSystemField ? 'System' : fieldId);
            const fieldType = fieldMeta?.type;
            const fieldRelationship = fieldMeta?.relationship;
            const FieldIcon = fieldType ? getFieldTypeIcon(fieldType) : null;
            const hasError = fieldResults.some((r) => r.status === 'error');
            const hasWarn = fieldResults.some((r) => r.status === 'warn');
            const allSuccess = fieldResults.every(
              (r) => r.status === 'success' || r.status === 'running'
            );

            return (
              <div
                key={fieldId}
                className={cn(
                  'rounded-lg border p-3 space-y-2',
                  hasError
                    ? 'border-destructive/40 bg-destructive/5'
                    : hasWarn
                      ? 'border-yellow-500/40 bg-yellow-500/5'
                      : allSuccess
                        ? 'border-green-500/40 bg-green-500/5'
                        : 'border-border/60 bg-muted/20'
                )}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {hasError ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : hasWarn ? (
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  ) : allSuccess ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
                  )}
                  {FieldIcon ? <FieldIcon className="h-4 w-4 text-muted-foreground" /> : null}
                  {fieldType === 'link' && fieldRelationship && fieldId !== 'system' ? (
                    <LinkFieldLabel
                      name={fieldName || 'System'}
                      fieldId={fieldId}
                      relationship={fieldRelationship}
                      isOneWay={fieldMeta?.isOneWay ?? false}
                    />
                  ) : (
                    <span>{fieldName || 'System'}</span>
                  )}
                  {fieldType ? (
                    <Badge
                      variant="outline"
                      className="h-5 px-1.5 text-[10px] font-normal uppercase"
                    >
                      {fieldType}
                    </Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground font-mono">
                    {fieldId !== 'system' && fieldId ? `(${fieldId})` : ''}
                  </span>
                </div>

                <div className="space-y-1.5 pl-6">
                  {fieldResults.map((result) => (
                    <RuleResultItem key={result.id} result={result} />
                  ))}
                </div>
              </div>
            );
          })}

          {isRunning && results.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting schema check...
            </div>
          )}

          {!isRunning && results.length === 0 && hasRun && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No results yet. The table may have no fields to check.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
