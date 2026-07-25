import type { IFieldInstance } from '@teable/sdk';
import type { ComputeActivityFieldClient } from '@teable/sdk/hooks';
import { useComputeActivity, useFields, useFieldStaticGetter } from '@teable/sdk/hooks';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { CircleAlert, Clock3, Loader2 } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

type ActivityItem = { field: IFieldInstance; meta: ComputeActivityFieldClient };

const formatCount = (value: number) => new Intl.NumberFormat().format(value);

const batchLabel = (count: number, state: 'running' | 'queued') =>
  `${count} ${count === 1 ? 'batch' : 'batches'} ${state}`;

const getActivitySummary = (activeCount: number, failedCount: number) => {
  if (activeCount > 0) {
    return `${activeCount} ${activeCount === 1 ? 'field' : 'fields'} calculating`;
  }
  return `${failedCount} field calculation${failedCount === 1 ? '' : 's'} failed`;
};

const FieldActivityStatus = ({ status }: { status: ComputeActivityFieldClient['status'] }) => {
  if (status === 'running') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-amber-600">
        <Loader2 className="size-3 animate-spin" /> Calculating
      </span>
    );
  }
  if (status === 'queued') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <Clock3 className="size-3" /> Waiting
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-destructive">
        <CircleAlert className="size-3" /> Failed
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
  const { field, meta } = item;
  const processingCount = meta.processingTaskCount ?? (meta.status === 'running' ? 1 : 0);
  const queuedCount = Math.max(0, (meta.activeTaskCount ?? 0) - processingCount);
  const progress = meta.batchProgress;
  const progressPercent = progress?.total
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;
  const batchStates = [
    processingCount > 0 ? batchLabel(processingCount, 'running') : null,
    queuedCount > 0 ? batchLabel(queuedCount, 'queued') : null,
  ].filter(Boolean);

  return (
    <div className="flex gap-3 rounded-md border bg-background p-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate font-medium text-foreground">{field.name}</span>
          <FieldActivityStatus status={meta.status} />
        </div>

        {meta.status === 'failed' ? (
          <p className="line-clamp-2 text-xs text-destructive">
            {meta.lastError?.message ?? 'Calculation failed'}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              {meta.estimatedDirtyRecords ? (
                <span>{formatCount(meta.estimatedDirtyRecords)} records</span>
              ) : null}
              {batchStates.length ? <span>{batchStates.join(' · ')}</span> : null}
            </div>
            {progress && progress.total > 1 ? (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {progress.completed} of {progress.total} batches complete
                  </span>
                  <span>{progressPercent}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-label={`${field.name} calculation progress`}
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.completed}
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-amber-500 transition-[width]"
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
      {items.map((item) => {
        const Icon = getIcon(item.field);
        return <FieldActivityRow key={item.field.id} item={item} Icon={Icon} />;
      })}
    </section>
  );
};

/** Current, permission-readable compute activity for the mounted table. */
export const ComputeActivityPanel = () => {
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

  if (!currentItems.length) return null;

  return (
    <div className="shrink-0">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2"
            aria-label={getActivitySummary(activeCount, failed.length)}
          >
            {activeCount > 0 ? (
              <Loader2 className="size-3.5 animate-spin text-amber-600" />
            ) : (
              <CircleAlert className="size-3.5 text-destructive" />
            )}
            <span className="hidden @xl/toolbar:inline">
              {getActivitySummary(activeCount, failed.length)}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="max-h-[min(32rem,70vh)] w-96 overflow-y-auto p-3">
          <div className="mb-3">
            <div className="font-medium text-foreground">Current calculations</div>
            <div className="text-xs text-muted-foreground">This table only</div>
          </div>
          <div className="space-y-4">
            <ActivityGroup label="Calculating now" items={running} getIcon={getIcon} />
            <ActivityGroup label="Waiting" items={queued} getIcon={getIcon} />
            <ActivityGroup label="Failed" items={failed} getIcon={getIcon} />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
