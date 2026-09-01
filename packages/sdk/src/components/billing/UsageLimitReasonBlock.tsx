import { AlertTriangle } from '@teable/icons';
import { UsageFeatureLimit } from '@teable/openapi';
import { cn } from '@teable/ui-lib';
import { useTranslation } from '../../context/app/i18n';
import { useUsageLimitReasonDisplay } from './store/usage-limit-reason';

// Decimal units to match the billing page's formatBytes and the plan copy: a
// 1,000,000,000-byte quota renders as the advertised "1 GB", not "0.93 GB".
const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes <= 0) return '0 Bytes';
  const k = 1000;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
};

/**
 * Situation banner explaining which plan limit the user ran into: a
 * human-readable headline, a usage meter and an optional "view details" link.
 * When the rejected operation carried an increment (e.g. a bulk paste), the
 * meter projects `current + increment` so the bar reflects why the operation
 * did not fit. Renders nothing when the modal was opened without a captured
 * reason (feature-gate badges etc.).
 */
export const UsageLimitReasonBlock = ({
  className,
  detailHref,
}: {
  className?: string;
  detailHref?: string;
}) => {
  const { t } = useTranslation();
  const reason = useUsageLimitReasonDisplay();
  if (!reason) return null;

  const { feature, message, limit, current, increment } = reason;
  const hasUsage = typeof limit === 'number' && typeof current === 'number' && limit > 0;
  const overLimit = hasUsage && current >= limit;
  const ratio = hasUsage ? Math.min(current / limit, 1) : 0;

  // Feature-aware plain-language copy; other features fall back to the
  // localized backend sentence as the headline.
  let title = message;
  let description: string | undefined;
  let unit = '';
  // Byte-sized features render as MB/GB; count features keep locale numbers.
  let formatValue = (value: number): string => value.toLocaleString();
  if (feature === UsageFeatureLimit.MaxSizeAttachments) {
    formatValue = formatBytes;
    unit = t('usageLimitBanner.attachments.unit');
  } else if (feature === 'credit') {
    unit = t('usageLimitBanner.credit.unit');
  }
  if (feature === UsageFeatureLimit.MaxRows && hasUsage) {
    const context = {
      current: current.toLocaleString(),
      limit: limit.toLocaleString(),
      increment: (increment ?? 0).toLocaleString(),
    };
    if (current >= limit) {
      // The space itself is already at/over the quota.
      title = t('usageLimitBanner.rows.title', context) as string;
    } else if (increment) {
      // Below the quota, and we know how many rows the operation would add.
      title = t('usageLimitBanner.rows.titleIncrement', context) as string;
    } else {
      // Below the quota but the batch (e.g. a CSV import) does not fit; the
      // attempted row count is unknown, so don't claim one.
      title = t('usageLimitBanner.rows.titleBatch', context) as string;
    }
    description = t('usageLimitBanner.rows.description') as string;
    unit = t('usageLimitBanner.rows.unit');
  }

  return (
    <div
      className={cn(
        // !mt: the block renders inside DialogHeader, whose space-y-1.5 rule
        // outranks a plain mt-* by specificity and would pin the gap to 6px.
        '!mt-4 flex items-start gap-3.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-[18px] py-4',
        className
      )}
    >
      <div className="flex size-9 flex-none items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
        <AlertTriangle className="size-[17px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold leading-6">{title}</div>
        {description && (
          <div className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
        {hasUsage && (
          // Mirrors the billing page's UsageCard meter: bold usage / quota with
          // the unit label, capped percentage on the right, progress bar below.
          <div className="mt-2.5 max-w-[460px]">
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-x-1 text-[13px]">
                <span
                  className={cn(
                    'font-semibold tabular-nums',
                    overLimit ? 'text-destructive' : 'text-foreground'
                  )}
                >
                  {formatValue(current)}
                </span>
                <span className="text-muted-foreground">/</span>
                <span className="tabular-nums">{formatValue(limit)}</span>
                {unit && <span className="ms-1 text-muted-foreground">{unit}</span>}
              </div>
              <div className="text-[13px] text-muted-foreground">
                {`${(ratio * 100).toFixed(1)}%`}
              </div>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full', overLimit ? 'bg-destructive' : 'bg-amber-500')}
                style={{ width: `${Math.max(ratio * 100, 2)}%` }}
              />
            </div>
          </div>
        )}
      </div>
      {detailHref && (
        <a
          href={detailHref}
          target="_blank"
          rel="noreferrer"
          className="flex-none pt-1 text-[13px] text-blue-500 hover:underline"
        >
          {`${t('usageLimitBanner.viewDetail')} →`}
        </a>
      )}
    </div>
  );
};
