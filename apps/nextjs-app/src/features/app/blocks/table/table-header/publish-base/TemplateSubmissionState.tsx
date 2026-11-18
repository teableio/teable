import { Link } from '@teable/icons';
import type { ITemplateReviewCheck, ITemplateVo } from '@teable/openapi';
import {
  isTemplateListed,
  isTemplateLive,
  isUnreleasedSubmission,
  TemplateCheckResult,
  TemplateReviewCheck,
} from '@teable/openapi';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  cn,
  Label,
  Textarea,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { CircleCheck, CircleX, Copy, ExternalLink, Info } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useContext, useEffect, useRef } from 'react';
import { TemplateHostContext } from '@/features/app/components/space/template/host-context';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { useOrigin } from '@/features/app/hooks/useOrigin';
import { asTranslate, type ITranslate } from '@/features/app/utils/translate';
import { TemplateShareButtons } from './TemplateShareButtons';

const CHECK_LABEL = {
  [TemplateReviewCheck.Content]: 'publishBase.review.check.content',
  [TemplateReviewCheck.Connectors]: 'publishBase.review.check.connectors',
  [TemplateReviewCheck.Privacy]: 'publishBase.review.check.privacy',
  [TemplateReviewCheck.Estimate]: 'publishBase.review.check.estimate',
  [TemplateReviewCheck.Trial]: 'publishBase.review.check.trial',
} as const;

export const describeCheck = (check: ITemplateReviewCheck, t: ITranslate): string | undefined => {
  // The one check that stops a submission, and the one that says something when it passes:
  // what the author vouched for as sample content.
  if (check.key === TemplateReviewCheck.Content) {
    if (check.result === TemplateCheckResult.Fail) {
      return t('space:publishBase.review.checkMessage.content', { count: check.open ?? 0 });
    }
    return check.marked
      ? t('space:publishBase.review.checkMessage.contentMarked', { count: check.marked })
      : undefined;
  }
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

/**
 * A published template: the version its link opens, whether the template centre lists it, the
 * link to share, and taking it down. Nothing without a host that reviews submissions, or while
 * nothing is published. The review after publishing only decides the listing, so it has no
 * say here.
 */
export const TemplateReviewPanel = ({
  template,
  onWithdraw,
  withdrawing,
  className,
  shareUrl,
}: {
  template: ITemplateVo | null | undefined;
  onWithdraw: () => void;
  withdrawing: boolean;
  className?: string;
  /** The template's short link, when there is one; the /t permalink otherwise. */
  shareUrl?: string;
}) => {
  const { t } = useTranslation(['space', 'common']);
  const dayjs = useLanDayjs();
  const origin = useOrigin();
  const isCloud = useIsCloud();
  const { submission } = useContext(TemplateHostContext);
  if (!submission || !template) return null;

  const live = isTemplateLive(template);
  // A submission from before publishing went live on submit: its link opens it while it waits.
  if (!live && !isUnreleasedSubmission(template)) return null;
  const history = [...(template.history ?? [])].reverse();
  const publicUrl = shareUrl || `${origin}/t/${template.id}`;

  const copyUrl = () => {
    navigator.clipboard.writeText(publicUrl);
    toast.success(t('publishBase.urlCopied'));
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-3 text-sm', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-transparent bg-green-100 text-green-900">
          {t('publishBase.review.live', { version: template.version })}
        </Badge>
        {isTemplateListed(template) && (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {t('publishBase.review.listed')}
          </Badge>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="xs"
              variant="ghost"
              className="ms-auto text-muted-foreground"
              disabled={withdrawing}
            >
              {withdrawing && <Spin className="size-3" />}
              {t('publishBase.review.withdraw')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('publishBase.review.withdrawConfirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('publishBase.review.withdrawConfirmDescription')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={onWithdraw}
              >
                {t('publishBase.review.withdraw')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
      {submission.renderShareActions?.({ template, shareUrl: publicUrl }) ??
        (isCloud && <TemplateShareButtons title={template.name ?? ''} shareUrl={publicUrl} />)}
      {live && submission.renderStatusExtra?.(template)}
      {live && history.length > 1 && (
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
  );
};

/** One automatic check: how it went, its name and what it has to say. */
export const CheckRow = ({ check }: { check: ITemplateReviewCheck }) => {
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
