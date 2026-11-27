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
  Badge,
  Button,
  cn,
  Label,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { Circle, CircleCheck, CircleHelp, CircleX, Copy, ExternalLink, Info } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useContext, useEffect, useRef, useState } from 'react';
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

export type IChecklistState = 'pass' | 'fail' | 'note' | 'todo';

const CHECKLIST_ICON: Record<IChecklistState, React.ReactNode> = {
  pass: <CircleCheck className="size-4 shrink-0 text-success" />,
  fail: <CircleX className="size-4 shrink-0 text-destructive" />,
  note: <Info className="size-4 shrink-0 text-muted-foreground" />,
  todo: <Circle className="size-4 shrink-0 text-muted-foreground" />,
};

const CHECKLIST_HEAD = 'flex min-h-10 w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5';

/**
 * One line of the checklist a version carries on the publish page: how it stands, what it is,
 * what there is to say about it and what to do. A line with more under it (`fold`) opens and
 * shuts wherever it is pressed: the button behind it spans the line, and what it does about
 * all it lists sits on top, at its end.
 */
export const ChecklistRow = ({
  state,
  label,
  value,
  action,
  children,
}: {
  state: IChecklistState;
  label: string;
  value?: React.ReactNode;
  /** What can be done about it, at the line's end after what it says. */
  action?: React.ReactNode;
  /** What shows under the line, when there is something to show. */
  children?: React.ReactNode;
}) => (
  <li>
    <div className={CHECKLIST_HEAD}>
      {CHECKLIST_ICON[state]}
      <span className="shrink-0 text-sm font-medium">{label}</span>
      {/* What it says sits at the line's end, one colour whatever the state: the icon tells them apart. */}
      <span className="min-w-0 flex-1 break-words text-end text-sm text-muted-foreground">
        {value}
      </span>
      {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
    </div>
    {children}
  </li>
);

const CHECK_STATE = {
  [TemplateCheckResult.Pass]: 'pass',
  [TemplateCheckResult.Warn]: 'note',
  [TemplateCheckResult.Fail]: 'fail',
} as const;

/** One automatic check as a line of the checklist. */
/**
 * What a check says at the end of its line on the publish page: as short as it goes. The runs
 * estimate keeps its sentence for the help icon beside the figure.
 */
const CheckLineValue = ({ check }: { check: ITemplateReviewCheck }) => {
  const { t } = useTranslation('space');
  const warns = check.result === TemplateCheckResult.Warn;
  if (warns && check.key === TemplateReviewCheck.Connectors) {
    return t('publishBase.review.checkLine.connectors', {
      providers: (check.providers ?? []).join(t('publishBase.listing.separator')),
    });
  }
  if (warns && check.key === TemplateReviewCheck.Estimate) {
    const detail = describeCheck(check, asTranslate(t));
    return (
      <span className="inline-flex items-center gap-1 tabular-nums">
        {t('publishBase.review.checkLine.estimate', { runs: check.runsPerMonth })}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={detail}
                className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CircleHelp className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{detail}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </span>
    );
  }
  return describeCheck(check, asTranslate(t));
};

export const CheckChecklistRow = ({ check }: { check: ITemplateReviewCheck }) => {
  const { t } = useTranslation('space');
  return (
    <ChecklistRow
      state={CHECK_STATE[check.result]}
      label={t(CHECK_LABEL[check.key])}
      value={<CheckLineValue check={check} />}
    />
  );
};

/** Taking a live template down, asked once more before it happens. */
/** The confirmation withdrawing asks for, opened by whatever offers it (a button, a menu item). */
export const TemplateWithdrawConfirm = ({
  open,
  onOpenChange,
  onWithdraw,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWithdraw: () => void;
}) => {
  const { t } = useTranslation(['space', 'common']);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
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
  );
};

export const TemplateWithdrawButton = ({
  onWithdraw,
  withdrawing,
  className,
}: {
  onWithdraw: () => void;
  withdrawing: boolean;
  className?: string;
}) => {
  const { t } = useTranslation(['space', 'common']);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        className={cn('text-muted-foreground', className)}
        disabled={withdrawing}
        onClick={() => setConfirming(true)}
      >
        {withdrawing && <Spin className="size-3" />}
        {t('publishBase.review.withdraw')}
      </Button>
      <TemplateWithdrawConfirm
        open={confirming}
        onOpenChange={setConfirming}
        onWithdraw={onWithdraw}
      />
    </>
  );
};

/**
 * What is done with a template that can be opened: its link, to copy or open, the share buttons,
 * and what the host adds under a live one.
 */
export const TemplateLiveActions = ({
  template,
  shareUrl,
}: {
  template: ITemplateVo;
  /** The template's short link, when there is one; the /t permalink otherwise. */
  shareUrl?: string;
}) => {
  const { t } = useTranslation(['space', 'common']);
  const origin = useOrigin();
  const isCloud = useIsCloud();
  const { submission } = useContext(TemplateHostContext);
  const publicUrl = shareUrl || `${origin}/t/${template.id}`;

  const copyUrl = () => {
    navigator.clipboard.writeText(publicUrl);
    toast.success(t('publishBase.urlCopied'));
  };

  return (
    <>
      <div className="flex h-9 items-center gap-2 overflow-hidden rounded-md border bg-background ps-3">
        <Link className="size-4 shrink-0" />
        <div className="min-w-0 grow truncate text-muted-foreground">{publicUrl}</div>
        {/* Square at the row's height inside its border, side by side, so icons and dividers line up. */}
        <div className="flex h-full shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="aspect-square h-full w-auto shrink-0 rounded-none border-s p-0"
            aria-label={t('common:actions.copyLink')}
            title={t('common:actions.copyLink')}
            onClick={copyUrl}
          >
            <Copy className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="aspect-square h-full w-auto shrink-0 rounded-none border-s p-0"
            aria-label={t('common:actions.openLink')}
            title={t('common:actions.openLink')}
            onClick={() => window.open(publicUrl, '_blank')}
          >
            <ExternalLink className="size-4" />
          </Button>
        </div>
      </div>
      {submission?.renderShareActions?.({ template, shareUrl: publicUrl }) ??
        (isCloud && <TemplateShareButtons title={template.name ?? ''} shareUrl={publicUrl} />)}
      {isTemplateLive(template) && submission?.renderStatusExtra?.(template)}
    </>
  );
};

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
  showName = false,
  showHistory = true,
}: {
  template: ITemplateVo | null | undefined;
  /** Taking it down. Not offered right after publishing, where a slip would undo it at once. */
  onWithdraw?: () => void;
  withdrawing?: boolean;
  className?: string;
  /** Name the template before its status, where nothing else on screen does (the success dialog). */
  showName?: boolean;
  /**
   * The versions out so far. Not right after publishing: the one just out is named in the status
   * above, and the history has its own place.
   */
  showHistory?: boolean;
  /** The template's short link, when there is one; the /t permalink otherwise. */
  shareUrl?: string;
}) => {
  const { t } = useTranslation(['space', 'common']);
  const { submission } = useContext(TemplateHostContext);
  if (!submission || !template) return null;

  const live = isTemplateLive(template);
  // A submission from before publishing went live on submit: its link opens it while it waits.
  if (!live && !isUnreleasedSubmission(template)) return null;
  const history = [...(template.history ?? [])].reverse();

  return (
    <div className={cn('flex min-w-0 flex-col gap-3 text-sm', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {showName && (
          <span className="min-w-0 truncate font-medium" title={template.name ?? undefined}>
            {template.name}
          </span>
        )}
        <Badge variant="outline" className="border-transparent bg-green-100 text-green-900">
          {t('publishBase.review.live', { version: template.version })}
        </Badge>
        {isTemplateListed(template) && (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {t('publishBase.review.listed')}
          </Badge>
        )}
        {onWithdraw && (
          <TemplateWithdrawButton
            className="ms-auto"
            onWithdraw={onWithdraw}
            withdrawing={Boolean(withdrawing)}
          />
        )}
      </div>
      <TemplateLiveActions template={template} shareUrl={shareUrl} />
      {showHistory && live && history.length > 1 && <VersionHistory history={history} />}
    </div>
  );
};

/**
 * The versions out so far, newest first: the latest on its own, the rest behind a toggle, so
 * a template with a long history does not push everything else down.
 */
const VersionHistory = ({ history }: { history: NonNullable<ITemplateVo['history']> }) => {
  const { t } = useTranslation(['space', 'common']);
  const dayjs = useLanDayjs();
  const [all, setAll] = useState(false);
  const shown = all ? history : history.slice(0, 1);
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        {shown.map((entry) => (
          <li key={entry.version} className="flex gap-2">
            <span className="w-6 shrink-0">v{entry.version}</span>
            <span className="w-20 shrink-0">{dayjs(entry.publishedTime).format('YYYY-MM-DD')}</span>
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
      <Button
        variant="ghost"
        size="xs"
        className="h-auto self-start p-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
        aria-expanded={all}
        onClick={() => setAll((open) => !open)}
      >
        {all
          ? t('publishBase.review.fewerVersions')
          : t('publishBase.review.allVersions', { count: history.length })}
      </Button>
    </div>
  );
};

/** One automatic check: how it went, its name and what it has to say. */
export const CheckRow = ({ check }: { check: ITemplateReviewCheck }) => {
  const { t } = useTranslation('space');
  const message = describeCheck(check, asTranslate(t));
  return (
    // What was checked reads as the row (14px, the body colour); what it found is its note (12px).
    <li className="flex items-start gap-2">
      <span className="flex h-5 shrink-0 items-center">{CHECK_ICON[check.result]}</span>
      <span className="shrink-0 text-sm leading-5">{t(CHECK_LABEL[check.key])}</span>
      {message && <span className="text-xs leading-5 text-muted-foreground">{message}</span>}
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
    // Laid out as the form's other fields: its label above, at the same size and gap.
    <div className="flex flex-col gap-2">
      <Label htmlFor="publish-changelog" className="leading-5">
        {t('publishBase.form.changelog')}
      </Label>
      <Textarea
        id="publish-changelog"
        className="min-h-24 resize-y"
        ref={ref}
        value={value}
        maxLength={2000}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('publishBase.form.changelogPlaceholder')}
      />
    </div>
  );
};
