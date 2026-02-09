import { useCallback, useEffect, useRef, useState } from 'react';

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
  FileSearch,
  Link2,
  Table2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LinkFieldLabel } from '@/components/playground/LinkFieldLabel';
import { getFieldTypeIcon } from '@/lib/fieldTypeIcons';
import { cn } from '@/lib/utils';

export type MetaValidationSeverity = 'error' | 'warning' | 'info';
export type MetaValidationCategory = 'schema' | 'reference';

export interface MetaValidationIssue {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  category: MetaValidationCategory;
  severity: MetaValidationSeverity;
  message: string;
  details?: {
    path?: string;
    expected?: string;
    received?: string;
    relatedTableId?: string;
    relatedFieldId?: string;
  };
}

interface MetaCheckSSEResult {
  id: string;
  type: 'connect' | 'issue' | 'complete' | 'error';
  issue?: MetaValidationIssue;
  message?: string;
  timestamp: number;
}

type FieldMeta = {
  id: string;
  name: string;
  type: string;
  relationship?: string;
  isOneWay?: boolean;
};

type MetaCheckPanelProps = {
  tableId: string;
  tableName: string;
  fields?: ReadonlyArray<FieldMeta>;
};

const SeverityIcon = ({ severity }: { severity: MetaValidationSeverity }) => {
  switch (severity) {
    case 'error':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case 'info':
    default:
      return <CheckCircle2 className="h-4 w-4 text-blue-500" />;
  }
};

const SeverityBadge = ({ severity }: { severity: MetaValidationSeverity }) => {
  const variants: Record<
    MetaValidationSeverity,
    'default' | 'secondary' | 'destructive' | 'outline'
  > = {
    error: 'destructive',
    warning: 'outline',
    info: 'secondary',
  };

  const labels: Record<MetaValidationSeverity, string> = {
    error: 'Error',
    warning: 'Warning',
    info: 'Info',
  };

  return (
    <Badge variant={variants[severity]} className="h-5 px-1.5 text-[10px] font-normal uppercase">
      {labels[severity]}
    </Badge>
  );
};

const CategoryIcon = ({ category }: { category: MetaValidationCategory }) => {
  switch (category) {
    case 'reference':
      return <Link2 className="h-3 w-3 text-muted-foreground" />;
    case 'schema':
    default:
      return <Table2 className="h-3 w-3 text-muted-foreground" />;
  }
};

/**
 * Renders a single issue result.
 */
const IssueResultItem = ({ issue }: { issue: MetaValidationIssue }) => {
  return (
    <div
      className={cn(
        'flex items-start gap-2 text-xs rounded-md p-2',
        issue.severity === 'error'
          ? 'bg-destructive/10'
          : issue.severity === 'warning'
            ? 'bg-yellow-500/10'
            : 'bg-blue-500/10'
      )}
    >
      <SeverityIcon severity={issue.severity} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <CategoryIcon category={issue.category} />
          <span className="font-medium capitalize">{issue.category}</span>
          <SeverityBadge severity={issue.severity} />
        </div>
        <div
          className={cn(
            'mt-1',
            issue.severity === 'error'
              ? 'text-destructive'
              : issue.severity === 'warning'
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-muted-foreground'
          )}
        >
          {issue.message}
        </div>
        {issue.details && (
          <div className="mt-1 text-[11px] text-muted-foreground space-y-0.5">
            {issue.details.path && (
              <div>
                Path: <code className="bg-muted px-1 rounded">{issue.details.path}</code>
              </div>
            )}
            {issue.details.relatedTableId && (
              <div>
                Related Table:{' '}
                <code className="bg-muted px-1 rounded">{issue.details.relatedTableId}</code>
              </div>
            )}
            {issue.details.relatedFieldId && (
              <div>
                Related Field:{' '}
                <code className="bg-muted px-1 rounded">{issue.details.relatedFieldId}</code>
              </div>
            )}
            {issue.details.expected && (
              <div>
                Expected: <code className="bg-muted px-1 rounded">{issue.details.expected}</code>
              </div>
            )}
            {issue.details.received && (
              <div>
                Received: <code className="bg-muted px-1 rounded">{issue.details.received}</code>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export function MetaCheckPanel({ tableId, tableName, fields }: MetaCheckPanelProps) {
  const [issues, setIssues] = useState<MetaValidationIssue[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const stopCheck = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsRunning(false);
  }, []);

  const startCheck = useCallback(() => {
    stopCheck();
    setIssues([]);
    setIsRunning(true);
    setHasRun(true);

    const dbUrl = resolvePlaygroundDbUrl();
    const baseUrl = `/api/meta/${tableId}/check/stream`;
    const eventSourceUrl = dbUrl
      ? `${baseUrl}?${new URLSearchParams({
          [PLAYGROUND_DB_URL_QUERY_PARAM]: dbUrl,
        }).toString()}`
      : baseUrl;
    const eventSource = new EventSource(eventSourceUrl);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const result = JSON.parse(event.data) as MetaCheckSSEResult;

        // Skip connection message
        if (result.type === 'connect') {
          return;
        }

        if (result.type === 'complete') {
          setIsRunning(false);
          eventSource.close();
          return;
        }

        if (result.type === 'error') {
          // Add error as an issue
          setIssues((prev) => [
            ...prev,
            {
              fieldId: '',
              fieldName: '',
              fieldType: '',
              category: 'schema',
              severity: 'error',
              message: result.message || 'Unknown error',
            },
          ]);
          setIsRunning(false);
          eventSource.close();
          return;
        }

        if (result.type === 'issue' && result.issue) {
          setIssues((prev) => [...prev, result.issue!]);
        }
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

  // Reset when tableId changes
  const hasStartedRef = useRef(false);
  useEffect(() => {
    hasStartedRef.current = false;
    setIssues([]);
    setHasRun(false);
    stopCheck();
  }, [tableId, stopCheck]);

  // Auto-start when entering the tab
  useEffect(() => {
    if (!hasStartedRef.current && !isRunning && !hasRun) {
      hasStartedRef.current = true;
      const timer = setTimeout(() => {
        startCheck();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [tableId, isRunning, hasRun, startCheck]);

  // Group issues by field
  const groupedIssues = issues.reduce<Record<string, MetaValidationIssue[]>>((acc, issue) => {
    const key = issue.fieldId || 'system';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(issue);
    return acc;
  }, {});

  // Summary counts
  const summary = {
    total: issues.length,
    error: issues.filter((i) => i.severity === 'error').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };

  // Get field meta by ID
  const getFieldMeta = (fieldId: string): FieldMeta | undefined => {
    return fields?.find((f) => f.id === fieldId);
  };

  return (
    <section className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <FileSearch className="h-4 w-4 text-muted-foreground" />
          Meta Check
          {hasRun && (
            <>
              {summary.total === 0 ? (
                <Badge
                  variant="secondary"
                  className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider text-green-600"
                >
                  ✓ All valid
                </Badge>
              ) : (
                <>
                  <Badge
                    variant="secondary"
                    className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
                  >
                    {summary.total} issues
                  </Badge>
                  {summary.error > 0 && (
                    <Badge
                      variant="destructive"
                      className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
                    >
                      ✗ {summary.error}
                    </Badge>
                  )}
                  {summary.warning > 0 && (
                    <Badge
                      variant="outline"
                      className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider text-yellow-600"
                    >
                      ⚠ {summary.warning}
                    </Badge>
                  )}
                </>
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
            Click "Start Check" to validate the meta data for table{' '}
            <span className="font-medium text-foreground">{tableName}</span>.
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            This will check field configurations including link references, lookup dependencies, and
            more.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Show success message if no issues */}
          {!isRunning && issues.length === 0 && hasRun && (
            <div className="rounded-lg border border-green-500/40 bg-green-500/5 p-6 text-center">
              <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
              <div className="text-sm font-medium text-green-600 dark:text-green-400">
                All meta data is valid
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                No issues found in field configurations.
              </div>
            </div>
          )}

          {/* Group issues by field */}
          {Object.entries(groupedIssues).map(([fieldId, fieldIssues]) => {
            const isSystemField = fieldId === 'system';
            const fieldMeta = getFieldMeta(fieldId);
            const fieldName =
              fieldMeta?.name || fieldIssues[0]?.fieldName || (isSystemField ? 'System' : fieldId);
            const fieldType = fieldMeta?.type || fieldIssues[0]?.fieldType;
            const fieldRelationship = fieldMeta?.relationship;
            const FieldIcon = fieldType ? getFieldTypeIcon(fieldType) : null;
            const hasError = fieldIssues.some((i) => i.severity === 'error');
            const hasWarning = fieldIssues.some((i) => i.severity === 'warning');

            return (
              <div
                key={fieldId}
                className={cn(
                  'rounded-lg border p-3 space-y-2',
                  hasError
                    ? 'border-destructive/40 bg-destructive/5'
                    : hasWarning
                      ? 'border-yellow-500/40 bg-yellow-500/5'
                      : 'border-blue-500/40 bg-blue-500/5'
                )}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {hasError ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : hasWarning ? (
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-blue-500" />
                  )}
                  {FieldIcon ? <FieldIcon className="h-4 w-4 text-muted-foreground" /> : null}
                  {fieldType === 'link' && fieldRelationship && fieldId !== 'system' ? (
                    <LinkFieldLabel
                      name={fieldName}
                      fieldId={fieldId}
                      relationship={fieldRelationship}
                      isOneWay={fieldMeta?.isOneWay ?? false}
                    />
                  ) : (
                    <span>{fieldName}</span>
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
                  {fieldIssues.map((issue, index) => (
                    <IssueResultItem key={`${fieldId}-${index}`} issue={issue} />
                  ))}
                </div>
              </div>
            );
          })}

          {isRunning && issues.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking meta data...
            </div>
          )}
        </div>
      )}
    </section>
  );
}
