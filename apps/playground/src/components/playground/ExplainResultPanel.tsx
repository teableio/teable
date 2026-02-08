import { useMemo, useState, useCallback } from 'react';
import type { IExplainResultDto } from '@teable/v2-contract-http';
import { format } from 'sql-formatter';
import { encode } from '@toon-format/toon';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  GitBranch,
  AlertTriangle,
  Zap,
  Layers,
  Lock,
  Table2,
  Copy,
  Code,
  LayoutDashboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getFieldTypeIcon } from '@/lib/fieldTypeIcons';
import { maskPlaygroundDbUrl, resolvePlaygroundDbUrl } from '@/lib/playground/databaseUrl';
import { usePlaygroundEnvironment } from '@/lib/playground/environment';

interface ExplainResultPanelProps {
  result: IExplainResultDto;
  className?: string;
}

type ComputedUpdateReason = NonNullable<IExplainResultDto['sqlExplains'][number]['computedReason']>;

function ComplexityScoreCard({ level, score }: { level: string; score: number }) {
  const config: Record<string, { bg: string; border: string; text: string; label: string }> = {
    trivial: {
      bg: 'bg-gradient-to-br from-green-50 to-green-100',
      border: 'border-green-200',
      text: 'text-green-700',
      label: 'Trivial',
    },
    low: {
      bg: 'bg-gradient-to-br from-blue-50 to-blue-100',
      border: 'border-blue-200',
      text: 'text-blue-700',
      label: 'Low',
    },
    medium: {
      bg: 'bg-gradient-to-br from-yellow-50 to-yellow-100',
      border: 'border-yellow-200',
      text: 'text-yellow-700',
      label: 'Medium',
    },
    high: {
      bg: 'bg-gradient-to-br from-orange-50 to-orange-100',
      border: 'border-orange-200',
      text: 'text-orange-700',
      label: 'High',
    },
    very_high: {
      bg: 'bg-gradient-to-br from-red-50 to-red-100',
      border: 'border-red-200',
      text: 'text-red-700',
      label: 'Very High',
    },
  };

  const c = config[level] ?? config.medium;

  return (
    <div className={cn('rounded-xl border-2 p-4 text-center', c.bg, c.border)}>
      <div className="flex items-center justify-center gap-2 mb-1">
        <Zap className={cn('h-5 w-5', c.text)} />
        <span className={cn('text-sm font-medium uppercase tracking-wide', c.text)}>
          Complexity
        </span>
      </div>
      <div className={cn('text-4xl font-bold', c.text)}>{score}</div>
      <div className={cn('text-sm font-medium mt-1', c.text)}>{c.label}</div>
    </div>
  );
}

function SqlBlock({ sql, parameters }: { sql: string; parameters: readonly unknown[] }) {
  const [copied, setCopied] = useState(false);

  const formattedSql = useMemo(() => {
    try {
      // Skip formatting for comments
      if (sql.startsWith('--')) {
        return sql;
      }
      return format(sql, {
        language: 'postgresql',
        tabWidth: 2,
        keywordCase: 'upper',
        linesBetweenQueries: 1,
      });
    } catch {
      return sql;
    }
  }, [sql]);

  const handleCopy = useCallback(async () => {
    const textToCopy =
      parameters.length > 0
        ? `${formattedSql}\n\n-- Parameters: ${JSON.stringify(parameters)}`
        : formattedSql;
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [formattedSql, parameters]);

  return (
    <div className="rounded-md bg-muted/50 p-3 font-mono text-xs relative group">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleCopy}
      >
        <Copy className="h-3 w-3" />
      </Button>
      {copied && (
        <span className="absolute top-2 right-10 text-[10px] text-muted-foreground">Copied!</span>
      )}
      <div className="h-64 w-full overflow-auto overscroll-contain">
        <pre className="whitespace-pre-wrap pr-4">{formattedSql}</pre>
      </div>
      {parameters.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <div className="text-muted-foreground">Parameters:</div>
          <div className="mt-1 overflow-x-auto">
            <pre className="whitespace-pre text-xs">{JSON.stringify(parameters)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function ExplainOutputBlock({
  output,
  isAnalyze,
}: {
  output: {
    plan: unknown;
    planningTimeMs?: number;
    executionTimeMs?: number;
    actualRows?: number;
    estimatedRows?: number;
    estimatedCost?: number;
  };
  isAnalyze: boolean;
}) {
  const formattedPlan = useMemo(() => {
    return JSON.stringify(output.plan, null, 2);
  }, [output.plan]);

  return (
    <div className="rounded-md bg-slate-900 text-slate-100 p-3 font-mono text-xs overflow-x-auto">
      <pre className="whitespace-pre-wrap max-h-64 overflow-y-auto">{formattedPlan}</pre>
      <div className="mt-2 pt-2 border-t border-slate-700 flex flex-wrap gap-3 text-slate-300">
        {output.planningTimeMs !== undefined && (
          <span>Planning: {output.planningTimeMs.toFixed(2)}ms</span>
        )}
        {output.executionTimeMs !== undefined && (
          <span>Execution: {output.executionTimeMs.toFixed(2)}ms</span>
        )}
        {output.estimatedRows !== undefined && <span>Est. rows: {output.estimatedRows}</span>}
        {output.actualRows !== undefined && isAnalyze && (
          <span>Actual rows: {output.actualRows}</span>
        )}
        {output.estimatedCost !== undefined && (
          <span>Est. cost: {output.estimatedCost.toFixed(2)}</span>
        )}
      </div>
    </div>
  );
}

function ComputedReasonBlock({ reason }: { reason: ComputedUpdateReason }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 rounded-md border bg-muted/40 text-xs">
      <button
        type="button"
        className="w-full px-3 py-2 flex items-center gap-2 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <GitBranch className="h-4 w-4" />
        <span className="font-medium">Computed Update Reason</span>
        <Badge variant="outline" className="text-[10px] h-4 px-1 uppercase">
          {reason.changeType}
        </Badge>
      </button>
      {open && (
        <div className="h-80 w-full overflow-auto overscroll-contain">
          <div className="space-y-3 px-3 pb-3 pr-4">
            {reason.notes.length > 0 && (
              <div className="text-muted-foreground">{reason.notes.join(' ')}</div>
            )}
            <div>
              <div className="text-[11px] font-medium text-muted-foreground mb-1">Triggered By</div>
              <div className="flex flex-wrap gap-1.5">
                {reason.seedFields.length > 0 ? (
                  reason.seedFields.map((seed) => {
                    const Icon = getFieldTypeIcon(seed.fieldType);
                    return (
                      <div
                        key={seed.fieldId}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-background border text-[11px]"
                        title={`${seed.tableName} · ${seed.fieldType}`}
                      >
                        <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="font-medium">{seed.fieldName}</span>
                        <span className="text-muted-foreground">({seed.fieldType})</span>
                        <Badge variant="secondary" className="text-[10px] h-4 px-1">
                          {seed.impact === 'link_relation' ? 'link' : 'value'}
                        </Badge>
                      </div>
                    );
                  })
                ) : (
                  <span className="text-muted-foreground">No seed fields</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-muted-foreground mb-1">Updates</div>
              <div className="space-y-2">
                {reason.targetFields.length > 0 ? (
                  reason.targetFields.map((target) => {
                    const Icon = getFieldTypeIcon(target.fieldType);
                    return (
                      <div
                        key={target.fieldId}
                        className="rounded-md border bg-background px-2 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium">{target.fieldName}</span>
                          <span className="text-muted-foreground">({target.fieldType})</span>
                        </div>
                        <div className="mt-1 space-y-1 text-[11px]">
                          {target.dependencies.length > 0 ? (
                            target.dependencies.map((dep, index) => (
                              <div
                                key={`${dep.fromFieldId}-${index}`}
                                className="flex flex-wrap items-center gap-1.5 text-muted-foreground"
                              >
                                <span className="font-medium text-foreground">
                                  {dep.fromTableName}.{dep.fromFieldName}
                                </span>
                                <span>({dep.fromFieldType})</span>
                                <Badge variant="outline" className="text-[10px] h-4 px-1">
                                  {dep.kind}
                                </Badge>
                                {dep.semantic && (
                                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                                    {dep.semantic}
                                  </Badge>
                                )}
                                {dep.isSeed && (
                                  <Badge variant="secondary" className="text-[10px] h-4 px-1">
                                    seed
                                  </Badge>
                                )}
                              </div>
                            ))
                          ) : (
                            <span className="text-muted-foreground">No direct dependencies</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <span className="text-muted-foreground">No computed targets</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-lg font-semibold">{value}</div>
      {subValue && <div className="text-xs text-muted-foreground">{subValue}</div>}
    </div>
  );
}

function SqlStepCard({
  sqlInfo,
  index,
  computedLocks,
}: {
  sqlInfo: IExplainResultDto['sqlExplains'][number];
  index: number;
  computedLocks: IExplainResultDto['computedLocks'];
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyStep = useCallback(async () => {
    const toonData = encode(sqlInfo);
    await navigator.clipboard.writeText(toonData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [sqlInfo]);

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-2 bg-muted/50 border-b">
        <div className="flex items-start gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs shrink-0">
            Step {index + 1}
          </Badge>
          <span
            className="text-sm font-medium break-words whitespace-normal min-w-0 flex-1"
            title={sqlInfo.stepDescription}
          >
            {sqlInfo.stepDescription}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={handleCopyStep}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{copied ? 'Copied!' : 'Copy step (Toon)'}</TooltipContent>
          </Tooltip>
        </div>
        {computedLocks && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-help">
                <Lock className="h-3 w-3" />
                <span>
                  Stage locks: {computedLocks.mode} · {computedLocks.recordLockCount} records ·{' '}
                  {computedLocks.tableLockCount} tables
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="max-w-[280px]">
              <div className="space-y-1">
                <div className="font-medium">Computed update locks</div>
                <div className="text-[11px] text-background/80">{computedLocks.reason}</div>
                <div className="text-[11px] text-background/80">
                  Applied once per update; the same lock set covers all steps.
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="p-4">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">SQL</div>
            <SqlBlock sql={sqlInfo.sql} parameters={sqlInfo.parameters} />
          </div>
          {(sqlInfo.explainError ||
            sqlInfo.explainAnalyze ||
            (sqlInfo.explainOnly && !sqlInfo.explainAnalyze)) && (
            <div>
              {sqlInfo.explainError ? (
                <div className="rounded-md border border-rose-100 bg-rose-50/60 px-3 py-2 text-xs text-rose-700">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
                    <div>
                      <div className="font-medium">Explain Error</div>
                      <div className="break-all">{sqlInfo.explainError}</div>
                    </div>
                  </div>
                </div>
              ) : sqlInfo.explainAnalyze ? (
                <>
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    EXPLAIN ANALYZE
                  </div>
                  <ExplainOutputBlock output={sqlInfo.explainAnalyze} isAnalyze={true} />
                </>
              ) : (
                <>
                  <div className="text-xs font-medium text-muted-foreground mb-2">EXPLAIN</div>
                  <ExplainOutputBlock output={sqlInfo.explainOnly!} isAnalyze={false} />
                </>
              )}
            </div>
          )}
        </div>
        {sqlInfo.computedReason && <ComputedReasonBlock reason={sqlInfo.computedReason} />}
      </div>
    </div>
  );
}

function generateOptimizationPromptText(result: IExplainResultDto, dbUrl: string | null): string {
  const lines: string[] = [];

  lines.push('# SQL Command EXPLAIN Analysis');
  lines.push(`DB URL: ${dbUrl ?? '(not set)'}`);
  lines.push('');
  lines.push(
    'You are a database performance engineer. Analyze this execution plan and identify performance issues, bottlenecks, and concrete optimization steps.'
  );
  lines.push(
    'Focus on expensive steps, sequential scans, row-estimate mismatch, missing indexes, lock contention, and computed field fan-out.'
  );
  lines.push(
    'Return a prioritized list of issues, quick wins, deeper schema/index changes, and any trade-offs or risks.'
  );
  lines.push('');

  // Command Info
  lines.push('## Command');
  lines.push(`- Type: ${result.command.type}`);
  lines.push(`- Table: ${result.command.tableName}`);
  lines.push(`- Change Type: ${result.command.changeType}`);
  if (result.command.changedFieldNames && result.command.changedFieldNames.length > 0) {
    lines.push(`- Changed Fields: ${result.command.changedFieldNames.join(', ')}`);
  }
  lines.push('');

  // Complexity
  lines.push('## Complexity Assessment');
  lines.push(`- Score: ${result.complexity.score}/100`);
  lines.push(`- Level: ${result.complexity.level}`);
  if (result.complexity.factors.length > 0) {
    lines.push('- Factors:');
    for (const f of result.complexity.factors) {
      lines.push(`  - ${f.name}: ${f.value} (contribution: +${f.contribution})`);
    }
  }
  if (result.complexity.recommendations.length > 0) {
    lines.push('- Recommendations:');
    for (const rec of result.complexity.recommendations) {
      lines.push(`  - ${rec}`);
    }
  }
  lines.push('');

  // Computed Impact
  if (result.computedImpact && result.computedImpact.updateSteps.length > 0) {
    lines.push('## Computed Field Impact');
    lines.push(`- Seed Record Count: ${result.computedImpact.seedRecordCount}`);
    lines.push(
      `- Dependency Graph: ${result.computedImpact.dependencyGraph.fieldCount} fields, ${result.computedImpact.dependencyGraph.edgeCount} edges`
    );
    lines.push('- Update Steps:');
    for (const step of result.computedImpact.updateSteps) {
      lines.push(
        `  - Level ${step.level}: ${step.tableName} - fields: ${step.fieldNames.join(', ')}`
      );
      if (step.warning) {
        lines.push(`    - Warning: ${step.warning}`);
      }
    }
    if (result.computedImpact.warnings && result.computedImpact.warnings.length > 0) {
      lines.push('- Warnings:');
      for (const warning of result.computedImpact.warnings) {
        lines.push(`  - ${warning}`);
      }
    }
    lines.push('');
  }

  // SQL Statements
  if (result.sqlExplains.length > 0) {
    lines.push('## SQL Statements');
    for (let i = 0; i < result.sqlExplains.length; i++) {
      const sqlInfo = result.sqlExplains[i];
      lines.push('');
      lines.push(`### Step ${i + 1}: ${sqlInfo.stepDescription}`);
      if (sqlInfo.explainError) {
        lines.push(`Explain Error: ${sqlInfo.explainError}`);
      }
      lines.push('```sql');
      lines.push(sqlInfo.sql);
      lines.push('```');
      if (sqlInfo.parameters.length > 0) {
        lines.push(`Parameters: ${JSON.stringify(sqlInfo.parameters)}`);
      }
      if (sqlInfo.explainAnalyze) {
        lines.push('');
        lines.push('EXPLAIN ANALYZE:');
        lines.push('```json');
        lines.push(JSON.stringify(sqlInfo.explainAnalyze.plan, null, 2));
        lines.push('```');
        if (sqlInfo.explainAnalyze.planningTimeMs !== undefined) {
          lines.push(`- Planning Time: ${sqlInfo.explainAnalyze.planningTimeMs}ms`);
        }
        if (sqlInfo.explainAnalyze.executionTimeMs !== undefined) {
          lines.push(`- Execution Time: ${sqlInfo.explainAnalyze.executionTimeMs}ms`);
        }
      } else if (sqlInfo.explainOnly) {
        lines.push('');
        lines.push('EXPLAIN:');
        lines.push('```json');
        lines.push(JSON.stringify(sqlInfo.explainOnly.plan, null, 2));
        lines.push('```');
      }
    }
    lines.push('');
  }

  if (result.computedLocks) {
    lines.push('## Computed Locks');
    lines.push(`- Mode: ${result.computedLocks.mode}`);
    lines.push(`- Reason: ${result.computedLocks.reason}`);
    lines.push(`- Record Locks: ${result.computedLocks.recordLockCount}`);
    lines.push(`- Table Locks: ${result.computedLocks.tableLockCount}`);
    lines.push('');
  }

  // Timing
  lines.push('## Timing');
  lines.push(`- Total: ${result.timing.totalMs}ms`);
  if (result.timing.dependencyGraphMs > 0) {
    lines.push(`- Dependency Graph: ${result.timing.dependencyGraphMs}ms`);
  }
  if (result.timing.planningMs > 0) {
    lines.push(`- Planning: ${result.timing.planningMs}ms`);
  }
  if (result.timing.sqlExplainMs > 0) {
    lines.push(`- SQL Explain: ${result.timing.sqlExplainMs}ms`);
  }

  return lines.join('\n');
}

function JsonViewPanel({ result }: { result: IExplainResultDto }) {
  const [copied, setCopied] = useState(false);

  const formattedJson = useMemo(() => {
    return JSON.stringify(result, null, 2);
  }, [result]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(formattedJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [formattedJson]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Code className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">JSON Analysis Result</h3>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1" onClick={handleCopy}>
          <Copy className="h-3.5 w-3.5" />
          {copied ? 'Copied!' : 'Copy JSON'}
        </Button>
      </div>
      <div className="flex-1 rounded-md border bg-slate-900 overflow-auto">
        <pre className="p-4 text-xs font-mono text-slate-100 whitespace-pre-wrap break-all">
          {formattedJson}
        </pre>
      </div>
    </div>
  );
}

export function ExplainResultPanel({ result, className }: ExplainResultPanelProps) {
  const env = usePlaygroundEnvironment();
  const [viewMode, setViewMode] = useState<'visual' | 'json'>('visual');
  const [impactOpen, setImpactOpen] = useState(true);
  const [locksOpen, setLocksOpen] = useState(false);
  const [linkLocksOpen, setLinkLocksOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<'raw' | 'optimized' | null>(null);

  const totalSteps = result.computedImpact?.updateSteps.length ?? 0;
  const totalRecords =
    result.computedImpact?.affectedRecordEstimates.reduce((sum, e) => sum + e.estimatedCount, 0) ??
    0;

  const resolveDbUrl = useCallback(() => {
    if (env.kind === 'sandbox') return env.pgliteConnectionString;
    return resolvePlaygroundDbUrl();
  }, [env]);

  const displayDbUrl = useMemo(() => {
    const dbUrl = resolveDbUrl();
    if (!dbUrl) return null;
    return maskPlaygroundDbUrl(dbUrl);
  }, [resolveDbUrl]);

  // Calculate total execution time from SQL explains
  const totalExecutionTime = useMemo(() => {
    let total = 0;
    let hasData = false;
    for (const sql of result.sqlExplains) {
      if (sql.explainAnalyze?.executionTimeMs !== undefined) {
        total += sql.explainAnalyze.executionTimeMs;
        hasData = true;
      }
    }
    return hasData ? total : null;
  }, [result.sqlExplains]);

  const totalPlanningTime = useMemo(() => {
    let total = 0;
    let hasData = false;
    for (const sql of result.sqlExplains) {
      if (sql.explainAnalyze?.planningTimeMs !== undefined) {
        total += sql.explainAnalyze.planningTimeMs;
        hasData = true;
      }
    }
    return hasData ? total : null;
  }, [result.sqlExplains]);

  const explainErrorCount = useMemo(
    () => result.sqlExplains.filter((sql) => sql.explainError).length,
    [result.sqlExplains]
  );

  const copyWithFeedback = useCallback(async (text: string, key: 'raw' | 'optimized') => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }, []);

  const handleCopyRaw = useCallback(async () => {
    const dbUrl = resolveDbUrl();
    const rawPayload = encode(result);
    await copyWithFeedback(`DB URL: ${dbUrl ?? '(not set)'}\n${rawPayload}`, 'raw');
  }, [copyWithFeedback, resolveDbUrl, result]);

  const handleCopyOptimized = useCallback(async () => {
    const dbUrl = resolveDbUrl();
    await copyWithFeedback(generateOptimizationPromptText(result, dbUrl), 'optimized');
  }, [copyWithFeedback, resolveDbUrl, result]);

  return (
    <div className={cn('flex flex-col h-[calc(85vh-120px)]', className)}>
      {/* View Mode Tabs */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'visual' | 'json')}>
          <TabsList>
            <TabsTrigger value="visual" className="gap-1.5">
              <LayoutDashboard className="h-3.5 w-3.5" />
              Visual
            </TabsTrigger>
            <TabsTrigger value="json" className="gap-1.5">
              <Code className="h-3.5 w-3.5" />
              JSON
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {viewMode === 'json' ? (
        <JsonViewPanel result={result} />
      ) : (
        <div className="flex gap-6 flex-1 min-h-0">
          {/* Left Panel - Overview */}
          <div className="w-[340px] shrink-0 overflow-auto">
            <div className="space-y-4 pr-4">
              {/* Complexity Score */}
              <ComplexityScoreCard
                level={result.complexity.level}
                score={result.complexity.score}
              />

              {/* Command Info */}
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">{result.command.type}</span>
                </div>
                <div className="flex items-start gap-2">
                  <Table2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <code className="text-sm bg-muted px-2 py-0.5 rounded break-all">
                    {result.command.tableName}
                  </code>
                </div>
                {result.command.changedFieldNames &&
                  result.command.changedFieldNames.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1.5">Changed Fields</div>
                      <div className="flex flex-wrap gap-1.5">
                        {result.command.changedFieldNames.map((name, i) => {
                          const fieldType =
                            result.command.changedFieldTypes?.[i] || 'singleLineText';
                          const Icon = getFieldTypeIcon(fieldType);
                          return (
                            <div
                              key={i}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted text-xs"
                              title={fieldType}
                            >
                              <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span>{name}</span>
                              <span className="text-muted-foreground">({fieldType})</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  icon={Clock}
                  label="Analyze Time"
                  value={`${result.timing.totalMs}ms`}
                  subValue={
                    result.timing.sqlExplainMs > 0
                      ? `SQL: ${result.timing.sqlExplainMs}ms`
                      : undefined
                  }
                />
                <StatCard
                  icon={Layers}
                  label="Steps"
                  value={totalSteps}
                  subValue={totalRecords > 0 ? `~${totalRecords} records` : undefined}
                />
                {explainErrorCount > 0 && (
                  <StatCard
                    icon={AlertTriangle}
                    label="Explain Errors"
                    value={explainErrorCount}
                    subValue="Failed explain steps"
                  />
                )}
              </div>

              {/* Execution Time - only show when ANALYZE data is available */}
              {totalExecutionTime !== null && (
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <Zap className="h-4 w-4" />
                    <span className="text-xs font-medium">SQL Execution Time</span>
                  </div>
                  <div className="text-2xl font-bold text-primary">
                    {totalExecutionTime.toFixed(2)}ms
                  </div>
                  {totalPlanningTime !== null && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Planning: {totalPlanningTime.toFixed(2)}ms
                    </div>
                  )}
                  <div className="mt-2 pt-2 border-t space-y-1">
                    {result.sqlExplains.map(
                      (sql, i) =>
                        sql.explainAnalyze?.executionTimeMs !== undefined && (
                          <div key={i} className="flex justify-between text-xs">
                            <span
                              className="text-muted-foreground truncate max-w-[180px]"
                              title={sql.stepDescription}
                            >
                              Step {i + 1}
                            </span>
                            <span className="font-mono">
                              {sql.explainAnalyze.executionTimeMs.toFixed(2)}ms
                            </span>
                          </div>
                        )
                    )}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {result.complexity.recommendations.length > 0 && (
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                  <div className="flex items-center gap-2 text-yellow-800 font-medium text-sm mb-2">
                    <AlertTriangle className="h-4 w-4" />
                    Recommendations
                  </div>
                  <ul className="list-disc list-inside text-xs text-yellow-700 space-y-1">
                    {result.complexity.recommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Complexity Factors */}
              {result.complexity.factors.length > 0 && (
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Complexity Factors
                  </div>
                  <div className="space-y-1.5">
                    {result.complexity.factors.map((f, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{f.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{f.value}</span>
                          <Badge variant="outline" className="text-[10px] h-4 px-1">
                            +{f.contribution}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Computed Impact */}
              {result.computedImpact && result.computedImpact.updateSteps.length > 0 && (
                <div className="rounded-lg border bg-card overflow-hidden">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2 rounded-none border-b h-10"
                    onClick={() => setImpactOpen(!impactOpen)}
                  >
                    {impactOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <GitBranch className="h-4 w-4" />
                    <span className="font-medium text-xs">
                      Computed Updates ({result.computedImpact.updateSteps.length})
                    </span>
                  </Button>
                  {impactOpen && (
                    <div className="p-3 space-y-2">
                      {result.computedImpact.updateSteps.map((step, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <Badge variant="outline" className="shrink-0 text-[10px] h-5">
                            L{step.level}
                          </Badge>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="font-medium break-all">{step.tableName}</div>
                              {step.status === 'blocked' && (
                                <Badge variant="destructive" className="text-[10px] h-4 px-1">
                                  Blocked
                                </Badge>
                              )}
                            </div>
                            <div className="text-muted-foreground break-all">
                              {step.fieldNames.join(', ')}
                            </div>
                            {step.warning && (
                              <div className="text-[10px] text-destructive break-words mt-1">
                                {step.warning}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Computed Locks */}
              {result.computedLocks && (
                <div className="rounded-lg border bg-card overflow-hidden">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2 rounded-none border-b h-9 text-muted-foreground"
                    onClick={() => setLocksOpen(!locksOpen)}
                  >
                    {locksOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <Lock className="h-4 w-4" />
                    <span className="font-medium text-[11px]">Computed Locks</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1 uppercase">
                      {result.computedLocks.mode}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1">
                      {result.computedLocks.recordLockCount} records
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1">
                      {result.computedLocks.tableLockCount} tables
                    </Badge>
                  </Button>
                  {locksOpen && (
                    <div className="p-3 space-y-3 text-xs">
                      <div className="text-muted-foreground">{result.computedLocks.reason}</div>
                      {result.computedLocks.tableLocks.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-medium text-muted-foreground">
                            Table Locks
                          </div>
                          {result.computedLocks.tableLocks.map((lock) => (
                            <div key={lock.key} className="flex flex-col gap-0.5">
                              <span className="font-medium">{lock.tableName}</span>
                              <span className="text-muted-foreground break-all">{lock.key}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {result.computedLocks.recordLocks.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-medium text-muted-foreground">
                            Record Locks
                          </div>
                          {result.computedLocks.recordLocks.map((lock) => (
                            <div key={lock.key} className="flex flex-col gap-0.5">
                              <span className="font-medium">{lock.tableName}</span>
                              <span className="text-muted-foreground break-all">
                                {lock.recordId}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {result.computedLocks.statements.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-medium text-muted-foreground">
                            Lock SQL
                          </div>
                          {result.computedLocks.statements.map((statement, index) => (
                            <div key={`${statement.key}-${index}`} className="space-y-1">
                              <div className="text-muted-foreground break-all">
                                {statement.tableName}
                                {statement.recordId ? ` · ${statement.recordId}` : ''}
                              </div>
                              <SqlBlock sql={statement.sql} parameters={statement.parameters} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Link Record Locks */}
              {result.linkLocks && result.linkLocks.mode === 'active' && (
                <div className="rounded-lg border bg-card overflow-hidden">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2 rounded-none border-b h-9 text-muted-foreground"
                    onClick={() => setLinkLocksOpen(!linkLocksOpen)}
                  >
                    {linkLocksOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <Lock className="h-4 w-4" />
                    <span className="font-medium text-[11px]">Link Record Locks</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1 uppercase">
                      {result.linkLocks.mode}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1">
                      {result.linkLocks.lockCount} records
                    </Badge>
                  </Button>
                  {linkLocksOpen && (
                    <div className="p-3 space-y-3 text-xs">
                      <div className="text-muted-foreground">{result.linkLocks.reason}</div>
                      {result.linkLocks.locks.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-medium text-muted-foreground">
                            Foreign Records
                          </div>
                          {result.linkLocks.locks.map((lock) => (
                            <div key={lock.key} className="flex flex-col gap-0.5">
                              <span className="font-medium">
                                {lock.foreignTableName ?? lock.foreignTableId}
                              </span>
                              <span className="text-muted-foreground break-all">
                                {lock.foreignRecordId}
                              </span>
                              <span className="text-muted-foreground/60 break-all text-[10px]">
                                {lock.key}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {result.linkLocks.sql && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-medium text-muted-foreground">
                            Lock SQL
                          </div>
                          <SqlBlock
                            sql={result.linkLocks.sql}
                            parameters={result.linkLocks.parameters ?? []}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - SQL */}
          <div className="flex-1 min-w-0 overflow-auto">
            <div className="space-y-4 pr-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-semibold">SQL Statements</h3>
                    <Badge variant="secondary" className="text-xs">
                      {result.sqlExplains.length}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    DB URL:{' '}
                    <span className="font-mono break-all">{displayDbUrl ?? '(not set)'}</span>
                  </div>
                </div>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-1">
                      <Zap className="h-3.5 w-3.5" />
                      AI Analysis
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="z-[60]">
                    <DropdownMenuItem onClick={handleCopyRaw} className="gap-2 cursor-pointer">
                      <Copy className="h-4 w-4" />
                      {copiedKey === 'raw' ? 'Copied raw!' : 'Copy raw (Toon)'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleCopyOptimized}
                      className="gap-2 cursor-pointer"
                    >
                      <Copy className="h-4 w-4" />
                      {copiedKey === 'optimized' ? 'Copied optimized!' : 'Copy optimized prompt'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {result.sqlExplains.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                  No SQL statements to display
                </div>
              ) : (
                <div className="space-y-4">
                  {result.sqlExplains.map((sqlInfo, i) => (
                    <SqlStepCard
                      key={i}
                      sqlInfo={sqlInfo}
                      index={i}
                      computedLocks={result.computedLocks}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
