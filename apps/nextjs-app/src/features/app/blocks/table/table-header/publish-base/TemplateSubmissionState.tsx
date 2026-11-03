import { Link } from '@teable/icons';
import type { ITemplateReviewCheck, ITemplateVo } from '@teable/openapi';
import { TemplateCheckResult, TemplateReviewCheck, TemplateReviewStatus } from '@teable/openapi';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Badge, Button, cn, Label, Textarea } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { CircleCheck, CircleX, Copy, ExternalLink, Info } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useContext, useEffect, useRef } from 'react';
import { TemplateHostContext } from '@/features/app/components/space/template/host-context';
import { useOrigin } from '@/features/app/hooks/useOrigin';
import { asTranslate, type ITranslate } from '@/features/app/utils/translate';

const STATUS_LABEL = {
  [TemplateReviewStatus.Review]: 'publishBase.review.status.review',
  [TemplateReviewStatus.Rejected]: 'publishBase.review.status.rejected',
  [TemplateReviewStatus.Withdrawn]: 'publishBase.review.status.withdrawn',
} as const;

const STATUS_CLASS: Record<TemplateReviewStatus, string> = {
  [TemplateReviewStatus.Review]:
    'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200',
  [TemplateReviewStatus.Rejected]: 'bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200',
  [TemplateReviewStatus.Withdrawn]: 'bg-muted text-muted-foreground',
};

const CHECK_LABEL = {
  [TemplateReviewCheck.Connectors]: 'publishBase.review.check.connectors',
  [TemplateReviewCheck.Privacy]: 'publishBase.review.check.privacy',
  [TemplateReviewCheck.Estimate]: 'publishBase.review.check.estimate',
  [TemplateReviewCheck.Trial]: 'publishBase.review.check.trial',
} as const;

export const describeCheck = (check: ITemplateReviewCheck, t: ITranslate): string | undefined => {
  if (check.result !== TemplateCheckResult.Warn) return undefined;
  switch (check.key) {
    case TemplateReviewCheck.Connectors:
      return t('space:publishBase.review.checkMessage.connectors', {
        providers: (check.providers ?? []).join(', '),
      });
    case TemplateReviewCheck.Estimate:
      return t('space:publishBase.review.checkMessage.estimate', {
        runs: check.runsPerMonth,
        free: check.freeRunsPerMonth,
      });
    case TemplateReviewCheck.Privacy:
      return t('space:publishBase.review.checkMessage.privacy');
    case TemplateReviewCheck.Trial:
      return t('space:publishBase.review.checkMessage.trial');
  }
};

const CHECK_ICON = {
  [TemplateCheckResult.Pass]: <CircleCheck className="size-4 shrink-0 text-green-600" />,
  [TemplateCheckResult.Warn]: <Info className="size-4 shrink-0 text-muted-foreground" />,
  [TemplateCheckResult.Fail]: <CircleX className="size-4 shrink-0 text-destructive" />,
} as const;

/** Where the listing stands; nothing without a host that reviews submissions, or without a listing. */
export const TemplateReviewPanel = ({
  template,
  onWithdraw,
  withdrawing,
  className,
}: {
  template: ITemplateVo | null | undefined;
  onWithdraw: () => void;
  withdrawing: boolean;
  className?: string;
}) => {
  const { t } = useTranslation(['space', 'common']);
  const dayjs = useLanDayjs();
  const origin = useOrigin();
  const { submission } = useContext(TemplateHostContext);
  if (!submission || !template) return null;

  const { review, version, isPublished } = template;
  const history = [...(template.history ?? [])].reverse();
  const publicUrl = isPublished ? `${origin}/t/${template.id}` : '';

  const copyUrl = () => {
    navigator.clipboard.writeText(publicUrl);
    toast.success(t('publishBase.urlCopied'));
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-3 text-sm', className)}>
      {publicUrl && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-transparent bg-green-100 text-green-900">
              {t('publishBase.review.live', { version })}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {t('publishBase.review.publicLink')}
            </span>
          </div>
          <div className="flex h-9 items-center gap-2 overflow-hidden rounded-md border bg-background ps-3">
            <Link className="size-4 shrink-0" />
            <div className="min-w-0 grow truncate text-muted-foreground">{publicUrl}</div>
            <Button
              size="icon"
              variant="ghost"
              className="size-9 shrink-0 rounded-none border-s p-0"
              onClick={copyUrl}
            >
              <Copy className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-9 shrink-0 rounded-none border-s p-0"
              onClick={() => window.open(publicUrl, '_blank')}
            >
              <ExternalLink className="size-4" />
            </Button>
          </div>
          {submission.renderStatusExtra?.(template)}
          {history.length > 1 && (
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {history.map((entry) => (
                <li key={entry.version} className="flex gap-2">
                  <span className="w-6 shrink-0">v{entry.version}</span>
                  <span className="w-20 shrink-0">
                    {dayjs(entry.publishedTime).format('YYYY-MM-DD')}
                  </span>
                  <span className="truncate">
                    {entry.changelog ||
                      t(
                        entry.version === 1
                          ? 'common:template.detail.firstRelease'
                          : 'common:template.detail.noChangelog'
                      )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {review && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn('border-transparent font-medium', STATUS_CLASS[review.status])}
            >
              {t(STATUS_LABEL[review.status])}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {t('publishBase.review.submittedTime', {
                time: dayjs(review.submittedTime).fromNow(),
              })}
            </span>
            {review.status === TemplateReviewStatus.Review && (
              <Button
                size="xs"
                variant="outline"
                className="ms-auto"
                onClick={onWithdraw}
                disabled={withdrawing}
              >
                {withdrawing && <Spin className="size-3" />}
                {t('publishBase.review.withdraw')}
              </Button>
            )}
          </div>
          {review.note && (
            <p className="text-xs">
              <span className="text-muted-foreground">{t('publishBase.review.note')}: </span>
              {review.note}
            </p>
          )}
          <div className="text-xs font-medium">{t('publishBase.review.checks')}</div>
          <ul className="flex flex-col gap-1">
            {review.checks.map((check) => (
              <CheckRow key={check.key} check={check} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const CheckRow = ({ check }: { check: ITemplateReviewCheck }) => {
  const { t } = useTranslation('space');
  const message = describeCheck(check, asTranslate(t));
  return (
    <li className="flex items-start gap-2 text-xs">
      {CHECK_ICON[check.result]}
      <span className="shrink-0 font-medium">{t(CHECK_LABEL[check.key])}</span>
      {message && <span className="text-muted-foreground">{message}</span>}
    </li>
  );
};

/** What a new version needs on top of a first submission: what changed. */
export const TemplateChangelogField = ({
  template,
  value,
  onChange,
  focusOnMount,
}: {
  template: ITemplateVo | null | undefined;
  value: string;
  onChange: (changelog: string) => void;
  focusOnMount?: boolean;
}) => {
  const { t } = useTranslation('space');
  const { submission } = useContext(TemplateHostContext);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  if (!submission || !template) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{t('publishBase.form.changelog')}</Label>
      <Textarea
        className="min-h-14 resize-y"
        ref={ref}
        value={value}
        maxLength={2000}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('publishBase.form.changelogPlaceholder')}
      />
    </div>
  );
};
