import { Badge, Button, ToggleGroup, ToggleGroupItem, cn } from '@teable/ui-lib/shadcn';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCcw,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'next-i18next';
import {
  getLocalizedDetailItems,
  getLocalizedResultMessage,
  getLocalizedRuleDescription,
  getGroupDisplayName,
  getGroupDisplayState,
  integrityFilterStatuses,
  getPhaseText,
  type GroupDisplayState,
  type IntegrityFilterStatus,
  type IntegrityPhase,
  type IntegrityResult,
  type IntegrityScope,
  type IntegritySummary,
  type ResultGroup,
  type TableResultGroup,
  type Translate,
} from './integrityV2Utils';

const StatusIcon = ({ status }: { status: IntegrityResult['status'] }) => {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="size-4 text-green-500" />;
    case 'error':
      return <XCircle className="size-4 text-destructive" />;
    case 'warn':
      return <AlertTriangle className="size-4 text-yellow-500" />;
    case 'skipped':
      return <Clock className="size-4 text-muted-foreground" />;
    case 'running':
      return <Loader2 className="size-4 animate-spin text-blue-500" />;
    case 'pending':
    default:
      return <Clock className="size-4 text-muted-foreground" />;
  }
};

const StatusBadge = ({ status }: { status: IntegrityResult['status'] }) => {
  const { t } = useTranslation(['table']);

  return (
    <Badge
      variant="outline"
      className="h-5 border-border px-1.5 text-[10px] font-normal uppercase text-muted-foreground"
    >
      {t(`table:table.integrity.v2.status.${status}`)}
    </Badge>
  );
};

const OutcomeBadge = ({ result }: { result: IntegrityResult }) => {
  const { t } = useTranslation(['table']);

  if (!('outcome' in result) || !result.outcome) {
    return null;
  }

  return (
    <Badge
      variant="outline"
      className="h-5 border-border px-1.5 text-[10px] font-normal uppercase text-muted-foreground"
    >
      {t(`table:table.integrity.v2.outcome.${result.outcome}`)}
    </Badge>
  );
};

const RuleResultItem = ({ result }: { result: IntegrityResult }) => {
  const { t } = useTranslation(['table']);
  const localizedMessage = getLocalizedResultMessage(t as Translate, result);
  const localizedMissing = getLocalizedDetailItems(t as Translate, result.details?.missing);
  const localizedExtra = getLocalizedDetailItems(t as Translate, result.details?.extra);

  return (
    <div className="py-3 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <StatusIcon status={result.status} />
        <span className="font-medium text-foreground">
          {getLocalizedRuleDescription(t as Translate, result)}
        </span>
        <StatusBadge status={result.status} />
        <OutcomeBadge result={result} />
        {!result.required ? (
          <Badge
            variant="outline"
            className="h-5 border-border px-1.5 text-[10px] font-normal uppercase text-muted-foreground"
          >
            {t('table:table.integrity.v2.optional')}
          </Badge>
        ) : null}
      </div>
      {localizedMessage ? (
        <div className="mt-2 text-muted-foreground">{localizedMessage}</div>
      ) : null}
      {localizedMissing?.length ? (
        <div className="mt-2 text-muted-foreground">
          {t('table:table.integrity.v2.detailsMissing', {
            details: localizedMissing.join(', '),
          })}
        </div>
      ) : null}
      {localizedExtra?.length ? (
        <div className="mt-1 text-muted-foreground">
          {t('table:table.integrity.v2.detailsExtra', {
            details: localizedExtra.join(', '),
          })}
        </div>
      ) : null}
      {result.details?.statementCount ? (
        <div className="mt-1 text-muted-foreground">
          {t('table:table.integrity.v2.statementCount', {
            count: result.details.statementCount,
          })}
        </div>
      ) : null}
    </div>
  );
};

export const SummaryBadges = ({
  summary,
  phase,
  baseId,
  baseName,
  tableId,
  tableName,
}: {
  summary: IntegritySummary;
  phase: IntegrityPhase;
  baseId?: string;
  baseName?: string;
  tableId?: string;
  tableName?: string;
}) => {
  const { t } = useTranslation(['table']);
  const targetLabel = tableId ? tableName || tableId : baseName || baseId;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{getPhaseText(t as Translate, phase, 'badge')}</Badge>
        {targetLabel ? (
          <Badge variant="outline" className="font-mono text-xs">
            {targetLabel}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{t('table:table.integrity.v2.summary.checks', { count: summary.total })}</span>
        <span>{t('table:table.integrity.v2.summary.problems', { count: summary.issueCount })}</span>
        {summary.repaired > 0 ? (
          <span>{t('table:table.integrity.v2.summary.repaired', { count: summary.repaired })}</span>
        ) : null}
        {summary.manual > 0 ? (
          <span>{t('table:table.integrity.v2.summary.manual', { count: summary.manual })}</span>
        ) : null}
      </div>
    </div>
  );
};

const filterChipClasses: Record<IntegrityFilterStatus, string> = {
  success:
    'border-green-500/30 text-green-700 data-[state=on]:border-green-500/50 data-[state=on]:bg-green-500/10 data-[state=on]:text-green-700',
  warn: 'border-yellow-500/30 text-yellow-700 data-[state=on]:border-yellow-500/50 data-[state=on]:bg-yellow-500/10 data-[state=on]:text-yellow-700',
  error:
    'border-destructive/30 text-destructive data-[state=on]:border-destructive/50 data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive',
  skipped:
    'border-muted-foreground/20 text-muted-foreground data-[state=on]:border-muted-foreground/30 data-[state=on]:bg-muted data-[state=on]:text-foreground',
};

export const IntegrityStatusFilters = ({
  summary,
  phase,
  selectedStatuses,
  onStatusesChange,
}: {
  summary: IntegritySummary;
  phase: IntegrityPhase;
  selectedStatuses: IntegrityFilterStatus[];
  onStatusesChange: (statuses: IntegrityFilterStatus[]) => void;
}) => {
  const { t } = useTranslation(['table']);
  const visibleStatuses = integrityFilterStatuses.filter((status) => {
    return status !== 'skipped' || phase === 'repair' || summary.skipped > 0;
  });

  const statusCounts: Record<IntegrityFilterStatus, number> = {
    success: summary.success,
    warn: summary.warn,
    error: summary.error,
    skipped: summary.skipped,
  };

  return (
    <ToggleGroup
      type="multiple"
      variant="outline"
      size="sm"
      value={selectedStatuses}
      onValueChange={(value) => onStatusesChange(value as IntegrityFilterStatus[])}
      className="flex flex-wrap justify-start gap-2"
    >
      {visibleStatuses.map((status) => (
        <ToggleGroupItem
          key={status}
          value={status}
          className={cn(
            'h-9 rounded-full border px-3 text-sm font-medium shadow-none',
            filterChipClasses[status]
          )}
        >
          {t(`table:table.integrity.v2.summary.${status}`, {
            count: statusCounts[status],
          })}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
};

export const IntegrityActions = ({
  canRun,
  hasRun,
  canRepair,
  isRunning,
  phase,
  onCheck,
  onRepair,
}: {
  canRun: boolean;
  hasRun: boolean;
  canRepair: boolean;
  isRunning: boolean;
  phase: IntegrityPhase;
  onCheck: () => void;
  onRepair: () => void;
}) => {
  const { t } = useTranslation(['table']);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={onCheck} disabled={!canRun || isRunning}>
        {isRunning && phase === 'check' ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <RefreshCcw className="mr-2 size-4" />
        )}
        {hasRun ? t('table:table.integrity.v2.recheck') : t('table:table.integrity.v2.runCheck')}
      </Button>
      <Button size="sm" onClick={onRepair} disabled={!canRepair}>
        {isRunning && phase === 'repair' ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <Wrench className="mr-2 size-4" />
        )}
        {t('table:table.integrity.v2.repair')}
      </Button>
      {isRunning ? (
        <span className="text-sm text-muted-foreground">
          {getPhaseText(t as Translate, phase, 'running')}
        </span>
      ) : null}
    </div>
  );
};

const GroupStateIcon = ({ displayState }: { displayState: GroupDisplayState }) => {
  if (displayState.hasError) {
    return <XCircle className="size-4 text-destructive" />;
  }

  if (displayState.hasWarn) {
    return <AlertTriangle className="size-4 text-yellow-500" />;
  }

  if (displayState.allSuccess) {
    return <CheckCircle2 className="size-4 text-green-500" />;
  }

  return <Loader2 className="size-4 animate-spin text-blue-500" />;
};

const IntegrityGroupCard = ({ group }: { group: ResultGroup }) => {
  const { t } = useTranslation(['table']);
  const displayState = getGroupDisplayState(group.results);
  const displayName = getGroupDisplayName(t as Translate, group);

  return (
    <section className="rounded-lg border border-border bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <GroupStateIcon displayState={displayState} />
        <span className="text-sm font-medium">{displayName}</span>
        {group.fieldId &&
        group.fieldId !== '__system__' &&
        !group.fieldId.startsWith('__system__:') ? (
          <span className="font-mono text-xs text-muted-foreground">{group.fieldId}</span>
        ) : null}
      </div>

      <div className="divide-y divide-border px-4">
        {group.results.map((result) => (
          <RuleResultItem key={result.id} result={result} />
        ))}
      </div>
    </section>
  );
};

const IntegrityTableCard = ({ group }: { group: TableResultGroup }) => {
  const displayState = getGroupDisplayState(group.results);

  return (
    <section className="rounded-xl border border-border bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <GroupStateIcon displayState={displayState} />
        <span className="text-sm font-medium">{group.tableName || group.tableId}</span>
        {group.tableId ? (
          <span className="font-mono text-xs text-muted-foreground">{group.tableId}</span>
        ) : null}
      </div>

      <div className="space-y-3 p-4">
        {group.groups.map((fieldGroup) => (
          <IntegrityGroupCard
            key={`${group.tableId}:${fieldGroup.fieldId || '__general__'}`}
            group={fieldGroup}
          />
        ))}
      </div>
    </section>
  );
};

export const IntegrityResultsPanel = ({
  scope,
  tableGroups,
  groupedResults,
  hasRun,
  isRunning,
  phase,
  hasTarget,
  hasFilteredOutAll,
}: {
  scope: IntegrityScope;
  tableGroups: TableResultGroup[];
  groupedResults: ResultGroup[];
  hasRun: boolean;
  isRunning: boolean;
  phase: IntegrityPhase;
  hasTarget: boolean;
  hasFilteredOutAll: boolean;
}) => {
  const { t } = useTranslation(['table']);
  const runningText = getPhaseText(t as Translate, phase, 'running');

  if (!hasTarget) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {t('table:table.integrity.v2.noTableSelected')}
      </div>
    );
  }

  if (!hasRun && !isRunning) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {t('table:table.integrity.v2.noResults')}
      </div>
    );
  }

  const hasResults = scope === 'base' ? tableGroups.length > 0 : groupedResults.length > 0;

  if (!hasResults) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
        {isRunning ? <Loader2 className="size-4 animate-spin" /> : null}
        {isRunning
          ? runningText
          : hasFilteredOutAll
            ? t('table:table.integrity.v2.noFilteredResults')
            : t('table:table.integrity.v2.noResults')}
      </div>
    );
  }

  if (scope === 'base') {
    return (
      <div className="space-y-4">
        {tableGroups.map((group) => (
          <IntegrityTableCard key={group.tableId || group.tableName} group={group} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groupedResults.map((group) => (
        <IntegrityGroupCard key={group.fieldId || '__general__'} group={group} />
      ))}
    </div>
  );
};
