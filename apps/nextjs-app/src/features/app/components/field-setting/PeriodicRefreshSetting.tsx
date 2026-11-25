import { analyzePeriodicRefreshSpec, type IFieldVo } from '@teable/core';
import { UsageFeatureLimit } from '@teable/openapi';
import { Label, Switch } from '@teable/ui-lib/shadcn';
import { Clock, Info } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useId, useMemo } from 'react';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { useIsEE } from '@/features/app/hooks/useIsEE';
import { tableConfig } from '@/features/i18n/table.config';
import type { IFieldEditorRo } from './type';

export const PeriodicRefreshSetting = ({
  field,
  periodicRefreshEnabled,
  onPeriodicRefreshEnabledChange,
}: {
  field: Partial<IFieldEditorRo> & Pick<Partial<IFieldVo>, 'periodicRefresh'>;
  periodicRefreshEnabled: boolean;
  onPeriodicRefreshEnabledChange: (enabled: boolean) => void;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const switchId = useId();
  const isEE = useIsEE();
  const isCloud = useIsCloud();
  const baseUsage = useBaseUsage();

  const spec = useMemo(
    () =>
      analyzePeriodicRefreshSpec({
        type: field.type,
        options: field.options,
        isLookup: field.isLookup,
        isConditionalLookup: field.isConditionalLookup,
        lookupOptions: field.lookupOptions,
      }),
    [field.type, field.options, field.isLookup, field.isConditionalLookup, field.lookupOptions]
  );

  const lastRefreshedAt = field.periodicRefresh?.lastRefreshedAt;
  const formattedLastRefreshed = useMemo(() => {
    if (!lastRefreshedAt) return null;
    const date = new Date(lastRefreshedAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
  }, [lastRefreshedAt]);

  if ((!isEE && !isCloud) || !spec.supported) {
    return null;
  }

  const canEnable = baseUsage?.limit?.[UsageFeatureLimit.PeriodicFieldRefreshEnable] === true;
  const showUpgrade = baseUsage != null && !canEnable;

  const lastStatus = field.periodicRefresh?.lastStatus;
  const showPausedDowngrade =
    showUpgrade && periodicRefreshEnabled && lastStatus === 'paused_plan_downgrade';
  const isUnhealthy = lastStatus === 'skipped_db_unhealthy';

  const cadenceLabel = (() => {
    if (spec.containsNowPrecision) {
      return t('table:field.editor.periodicRefresh.cadence15m');
    }
    if (spec.cadence === 'week') {
      return t('table:field.editor.periodicRefresh.cadenceWeekly');
    }
    if (spec.cadence === 'month') {
      return t('table:field.editor.periodicRefresh.cadenceMonthly');
    }
    return t('table:field.editor.periodicRefresh.cadenceDaily');
  })();

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs"
      data-testid="periodic-refresh-setting"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Clock className="size-3.5 text-muted-foreground" />
          <Label htmlFor={switchId} className="cursor-pointer text-xs font-medium">
            {t('table:field.editor.periodicRefresh.autoRefreshToggle')}
          </Label>
        </div>
        <Switch
          id={switchId}
          checked={periodicRefreshEnabled}
          disabled={!canEnable && !periodicRefreshEnabled}
          onCheckedChange={onPeriodicRefreshEnabledChange}
          data-testid="periodic-refresh-toggle"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        <span className="rounded bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground ring-1 ring-border">
          {cadenceLabel}
        </span>
        <span>
          {t('table:field.editor.periodicRefresh.timezoneLabel', { timeZone: spec.timeZone })}
        </span>
        {formattedLastRefreshed && (
          <span>
            ·{' '}
            {t('table:field.editor.periodicRefresh.lastRefreshedAt', {
              time: formattedLastRefreshed,
            })}
          </span>
        )}
      </div>

      {spec.containsNowPrecision && (
        <div className="flex items-start gap-1.5 rounded bg-background/80 p-2 text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>{t('table:field.editor.periodicRefresh.nowPrecisionNotice')}</span>
        </div>
      )}

      {showUpgrade && (
        <p className="text-amber-600 dark:text-amber-400">
          {t(
            showPausedDowngrade
              ? 'table:field.editor.periodicRefresh.statusPausedDowngrade'
              : 'table:field.editor.periodicRefresh.upgradeTip'
          )}
        </p>
      )}

      {isUnhealthy && (
        <p className="text-amber-600 dark:text-amber-400">
          {t('table:field.editor.periodicRefresh.statusUnhealthy')}
        </p>
      )}
    </div>
  );
};
