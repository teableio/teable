import type { IFieldInstance } from '@teable/sdk';
import type { ComputeActivityFieldClient } from '@teable/sdk/hooks';
import { useComputeActivity, useFields, useFieldStaticGetter } from '@teable/sdk/hooks';
import { Badge, Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { CircleAlert, Clock3, Loader2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { ComponentType, SVGProps } from 'react';

type ActivityItem = { field: IFieldInstance; meta: ComputeActivityFieldClient };

const formatCount = (value: number, locale: string) => new Intl.NumberFormat(locale).format(value);

const FieldActivityStatus = ({ status }: { status: ComputeActivityFieldClient['status'] }) => {
  const { t } = useTranslation('table');

  if (status === 'running') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-blue-600 dark:text-blue-500">
        <Loader2 className="size-3 animate-spin" /> {t('computeActivity.calculating')}
      </span>
    );
  }
  if (status === 'queued') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <Clock3 className="size-3" /> {t('computeActivity.waiting')}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-red-600 dark:text-red-500">
        <CircleAlert className="size-3" /> {t('computeActivity.failed')}
      </span>
    );
  }
  return null;
};

const FieldActivityRow = ({
  item,
  Icon,
}: {
  item: ActivityItem;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}) => {
  const { t, i18n } = useTranslation('table');
  const { field, meta } = item;
  const processingCount = meta.processingTaskCount ?? (meta.status === 'running' ? 1 : 0);
  const queuedCount = Math.max(0, (meta.activeTaskCount ?? 0) - processingCount);
  const progress = meta.batchProgress;
  const progressPercent = progress?.total
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;
  const batchStates = [
    processingCount > 0 ? t('computeActivity.batchesRunning', { count: processingCount }) : null,
    queuedCount > 0 ? t('computeActivity.batchesQueued', { count: queuedCount }) : null,
  ].filter(Boolean);

  return (
    <div className="flex gap-3 p-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium text-foreground">{field.name}</span>
          <FieldActivityStatus status={meta.status} />
        </div>

        {meta.status === 'failed' ? (
          <p className="line-clamp-2 text-xs text-red-600 dark:text-red-500">
            {meta.lastError?.message ?? t('computeActivity.calculationFailed')}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap justify-between gap-x-2 text-xs text-muted-foreground">
              {meta.estimatedDirtyRecords ? (
                <span>
                  {t('computeActivity.records', {
                    count: meta.estimatedDirtyRecords,
                    formattedCount: formatCount(
                      meta.estimatedDirtyRecords,
                      i18n.resolvedLanguage ?? i18n.language
                    ),
                  })}
                </span>
              ) : null}
              {batchStates.length ? <span>{batchStates.join(' · ')}</span> : null}
            </div>
            {progress && progress.total > 1 ? (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {t('computeActivity.batchesComplete', {
                      completed: progress.completed,
                      total: progress.total,
                    })}
                  </span>
                  <span>{progressPercent}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-label={t('computeActivity.progressAriaLabel', {
                    fieldName: field.name,
                  })}
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.completed}
                  className="h-1.5 overflow-hidden rounded-full bg-surface"
                >
                  <div
                    className="h-full rounded-full bg-muted-foreground/70 transition-[width]"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};

const ActivityGroup = ({
  label,
  items,
  getIcon,
}: {
  label: string;
  items: ActivityItem[];
  getIcon: (field: IFieldInstance) => ComponentType<SVGProps<SVGSVGElement>>;
}) => {
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label} · {items.length}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-md border bg-transparent dark:bg-white/5">
        {items.map((item) => {
          const Icon = getIcon(item.field);
          return <FieldActivityRow key={item.field.id} item={item} Icon={Icon} />;
        })}
      </div>
    </section>
  );
};

/** Current, permission-readable compute activity for the mounted table. */
export const ComputeActivityPanel = () => {
  const { t } = useTranslation('table');
  const { fieldMetaById } = useComputeActivity();
  const fields = useFields({ withHidden: true, withDenied: true });
  const fieldStaticGetter = useFieldStaticGetter();
  const getIcon = (field: IFieldInstance) =>
    fieldStaticGetter(field.type, {
      isLookup: field.isLookup,
      isConditionalLookup: field.isConditionalLookup,
      hasAiConfig: Boolean(field.aiConfig),
    }).Icon;
  const currentItems = fields.flatMap((field) => {
    if (field.canReadFieldRecord === false) return [];
    const meta = fieldMetaById[field.id];
    return meta && meta.status !== 'idle' ? [{ field, meta }] : [];
  });
  const running = currentItems.filter((item) => item.meta.status === 'running');
  const queued = currentItems.filter((item) => item.meta.status === 'queued');
  const failed = currentItems.filter((item) => item.meta.status === 'failed');
  const activeCount = running.length + queued.length;
  const failedCount = failed.length;
  const summary =
    activeCount > 0
      ? t('computeActivity.calculatingSummary', { count: activeCount })
      : t('computeActivity.failedSummary', { count: failedCount });
  const ariaLabel =
    activeCount > 0
      ? t('computeActivity.fieldsCalculating', { count: activeCount })
      : t('computeActivity.fieldCalculationsFailed', { count: failedCount });

  if (!currentItems.length) return null;

  return (
    <div className="shrink-0">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2" aria-label={ariaLabel}>
            {activeCount > 0 ? (
              <Loader2 className="size-3.5 animate-spin text-blue-600 dark:text-blue-500" />
            ) : (
              <CircleAlert className="size-3.5 text-red-600 dark:text-red-500" />
            )}
            <span className="hidden @xl/toolbar:inline">{summary}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="max-h-[min(32rem,70vh)] w-96 overflow-y-auto p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="font-medium text-foreground">
              {t('computeActivity.currentCalculations')}
            </div>
            <Badge
              variant="secondary"
              className="h-5 shrink-0 px-1.5 py-0 font-normal text-muted-foreground"
            >
              {t('computeActivity.thisTableOnly')}
            </Badge>
          </div>
          <div className="space-y-4">
            <ActivityGroup
              label={t('computeActivity.calculatingNow')}
              items={running}
              getIcon={getIcon}
            />
            <ActivityGroup label={t('computeActivity.waiting')} items={queued} getIcon={getIcon} />
            <ActivityGroup label={t('computeActivity.failed')} items={failed} getIcon={getIcon} />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
