import type { IFieldInstance } from '@teable/sdk';
import type { ComputeActivityFieldClient } from '@teable/sdk/hooks';
import { useComputeActivity, useFields, useFieldStaticGetter } from '@teable/sdk/hooks';
import { Badge, Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { CircleAlert, Clock3, Loader2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { ComponentType, SVGProps } from 'react';

const COMPUTED_CELL_VALUE_MAX_BYTES_CODE = 'validation.limit.computed_cell_value_max_bytes';

const FieldActivityErrorText = ({
  lastError,
}: {
  lastError: ComputeActivityFieldClient['lastError'];
}) => {
  const { t } = useTranslation('table');
  if (!lastError) {
    return t('computeActivity.calculationFailed');
  }
  if (lastError.code === COMPUTED_CELL_VALUE_MAX_BYTES_CODE) {
    return t('computeActivity.cellValueTooLarge', {
      attempted: lastError.context?.attempted,
      max: lastError.context?.max,
    });
  }
  return lastError.message;
};

type ActivityItem = { field: IFieldInstance; meta: ComputeActivityFieldClient };

const formatCount = (value: number, locale: string) => new Intl.NumberFormat(locale).format(value);

const FieldActivityStatus = ({ status }: { status: ComputeActivityFieldClient['status'] }) => {
  const { t } = useTranslation('table');

  if (status === 'running') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-blue-600 dark:text-blue-500">
        <Loader2 className="size-3 animate-spin" />
        {t('computeActivity.calculating')}
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
  const progress = meta.status === 'running' ? meta.batchProgress : undefined;
  const progressPercent =
    progress && progress.total > 1
      ? Math.round((progress.completed / progress.total) * 100)
      : undefined;

  return (
    <div className="flex items-center gap-3 p-3">
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
            <FieldActivityErrorText lastError={meta.lastError} />
          </p>
        ) : meta.estimatedDirtyRecords || progressPercent != null ? (
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            {meta.estimatedDirtyRecords
              ? t('computeActivity.records', {
                  count: meta.estimatedDirtyRecords,
                  formattedCount: formatCount(
                    meta.estimatedDirtyRecords,
                    i18n.resolvedLanguage ?? i18n.language
                  ),
                })
              : null}
            {progressPercent != null ? (
              <span className="ms-auto shrink-0 text-muted-foreground">{progressPercent}%</span>
            ) : null}
          </div>
        ) : null}
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
        <PopoverContent
          align="end"
          className="flex max-h-[min(32rem,70vh)] w-96 flex-col overflow-hidden p-0"
        >
          <div className="shrink-0 px-4 pt-4">
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
          </div>
          <div className="min-h-0 overflow-y-auto px-4 pb-4">
            <div className="space-y-4">
              <ActivityGroup
                label={t('computeActivity.calculatingNow')}
                items={running}
                getIcon={getIcon}
              />
              <ActivityGroup
                label={t('computeActivity.waiting')}
                items={queued}
                getIcon={getIcon}
              />
              <ActivityGroup label={t('computeActivity.failed')} items={failed} getIcon={getIcon} />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
