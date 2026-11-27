import type { ITemplateVo } from '@teable/openapi';
import { isTemplateListed, isTemplateLive } from '@teable/openapi';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Button, PopoverContent, Skeleton } from '@teable/ui-lib/shadcn';
import { ChevronUp, Pencil } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { TemplateWithdrawButton } from './TemplateSubmissionState';

/** The versions a template has put out, newest first. A template from before versions were recorded still has the one that is live. */
const versionsOf = (template: ITemplateVo) => {
  const recorded = [...(template.history ?? [])].reverse();
  return recorded.length || !isTemplateLive(template)
    ? recorded
    : [{ version: template.version, publishedTime: undefined, changelog: undefined }];
};

/** Whether the template has put out a version yet, so there is a history to show. */
export const hasTemplateVersions = (template: ITemplateVo | null | undefined) =>
  Boolean(template && versionsOf(template).length);

/**
 * A template's version history, shown as the app's is (without its picking: a template's versions
 * are not rolled back to): newest first, the live one tagged, when each went out at the end of its line, what it changed under it. A popover's
 * content, opened from beside the publish button or from the home tab's "More"; with
 * `onWithdraw`, its foot carries the way to withdraw the live version.
 */
export const TemplateVersionHistoryContent = ({
  template,
  onWithdraw,
  withdrawing = false,
}: {
  template: ITemplateVo;
  onWithdraw?: () => void;
  withdrawing?: boolean;
}) => {
  const { t } = useTranslation(['space', 'common']);
  const dayjs = useLanDayjs();
  const live = isTemplateLive(template);
  const thisYear = new Date().getFullYear();
  return (
    <PopoverContent className="w-80 p-0" align="end">
      <div className="px-4 pb-1 pt-3">
        <h4 className="text-sm font-semibold">{t('publishBase.timeline.versions')}</h4>
      </div>
      <ol className="flex max-h-96 flex-col overflow-y-auto pb-2">
        {versionsOf(template).map((entry, index) => {
          const current = live && index === 0;
          const time = entry.publishedTime ? dayjs(entry.publishedTime) : undefined;
          const description =
            entry.changelog ||
            t(
              entry.version === 1
                ? 'common:template.detail.firstRelease'
                : 'common:template.detail.noChangelog'
            );
          return (
            <li key={entry.version} className="flex flex-col gap-0.5 px-4 py-1.5">
              <span className="flex h-5 min-w-0 items-center gap-2">
                <span className="shrink-0 text-sm font-medium">v{entry.version}</span>
                {current && (
                  // Shaped as the app's "Published" tag, in the success token.
                  <span className="inline-flex h-5 shrink-0 items-center rounded-sm bg-success/10 px-1.5 text-xs text-success">
                    {t('publishBase.timeline.published')}
                  </span>
                )}
                {current && isTemplateListed(template) && (
                  <span className="truncate text-xs text-muted-foreground">
                    {t('publishBase.review.listed')}
                  </span>
                )}
                <span className="min-w-0 flex-1" />
                {time && (
                  <time className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {time.format(time.year() === thisYear ? 'MM-DD HH:mm' : 'YYYY-MM-DD HH:mm')}
                  </time>
                )}
              </span>
              <span className="truncate text-xs text-muted-foreground" title={description}>
                {description}
              </span>
            </li>
          );
        })}
      </ol>
      {live && onWithdraw && (
        <div className="flex justify-end border-t p-2">
          <TemplateWithdrawButton onWithdraw={onWithdraw} withdrawing={withdrawing} />
        </div>
      )}
    </PopoverContent>
  );
};

const SECTION_TITLE = 'text-sm font-medium leading-5';

export interface IListingSummary {
  title: string;
  description: string | undefined;
  coverUrl: string | undefined;
  /** Cover, name and description are all set. */
  complete: boolean;
}

/**
 * What the template centre's card shows. While something it needs is missing its fields are open
 * to fill in; once it is complete it is one line (the cover, the name, the description) with
 * "Edit" to open them, since a version after the first rarely changes it. Opened, it stays open
 * until folded away again: finishing the last field does not shut it under the author's hands.
 */
const ListingSection = ({
  summary,
  fields,
}: {
  summary: IListingSummary;
  fields: React.ReactNode;
}) => {
  const { t } = useTranslation(['space', 'common']);
  const [editing, setEditing] = useState(!summary.complete);
  // Opened by something going missing, it stays open once it is put back.
  useEffect(() => {
    if (!summary.complete) setEditing(true);
  }, [summary.complete]);
  const open = editing || !summary.complete;
  // A cover that cannot be read leaves the plain thumbnail, not the browser's broken image.
  const [failedCover, setFailedCover] = useState<string>();
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className={SECTION_TITLE}>{t('publishBase.listing.title')}</h3>
        {summary.complete && (
          <Button
            size="xs"
            variant="outline"
            aria-expanded={open}
            onClick={() => setEditing(!open)}
          >
            {open ? <ChevronUp className="size-4" /> : <Pencil className="size-4" />}
            {t(open ? 'common:actions.collapse' : 'common:actions.edit')}
          </Button>
        )}
      </div>
      {open ? (
        // The same card as the summary, grown in place, so the group keeps its edge either way.
        <div className="flex flex-col gap-4 rounded-lg border bg-background p-4">{fields}</div>
      ) : (
        <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-background p-3">
          {/* The preview card's own proportion (the template centre's small card). */}
          <div className="aspect-[16/10] w-24 shrink-0 overflow-hidden rounded-md border bg-muted">
            {summary.coverUrl && failedCover !== summary.coverUrl && (
              <img
                src={summary.coverUrl}
                alt=""
                className="size-full object-cover"
                onError={() => setFailedCover(summary.coverUrl)}
              />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{summary.title}</span>
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {summary.description}
            </span>
          </div>
        </div>
      )}
    </section>
  );
};

export interface IPublishTimelineProps {
  header: React.ReactNode;
  /** The listing is still being read: which versions there are is not known yet. */
  loading: boolean;
  /** What kind of project it is is still being read: the checks are not known yet. */
  pending: boolean;
  template: ITemplateVo | null | undefined;
  /** What the template centre's card shows and where the template opens: the fields that set it. */
  listing: React.ReactNode;
  listingSummary: IListingSummary;
  /** What is checked before publishing, as `<li>`s, each saying where it stands at its end. */
  checks: React.ReactNode;
  /** Any other project has no checks, only its guide. */
  guideRow: React.ReactNode;
  /** The release notes, once there is a version before this one to tell installers about. */
  changelogField: React.ReactNode;
  termsBar: React.ReactNode;
  publishButton: React.ReactNode;
  /** Where the template stands: a submission still waiting, or the live one's link and actions. */
  reviewPanel: React.ReactNode;
  /**
   * The live template's link, history and withdrawal have a place of their own (a template
   * project's home card and sidebar menu), so the page leaves them out once it is live. A project
   * published before template projects has no such place: the page keeps them.
   */
  liveActionsElsewhere?: boolean;
  /** Under the publish box: what a listing published without a review still has to show. */
  extra: React.ReactNode;
  previewCard: React.ReactNode;
  contents: React.ReactNode;
}

/**
 * The publish tab, the same before and after the first publish. On the left, what the author fills
 * in (the listing), then what is checked for them (each check's standing at its end, an action
 * where there is one), then the release notes; the publish button is fixed at the column's foot.
 * Nothing folds: what is to
 * be written is open, what is checked is one line. On the right, what it will look like in the
 * template centre and what it carries, once the pane is wide enough for both (the pane's width,
 * not the window's). The version history and withdrawing are on the project's home tab.
 */
export const PublishTimelinePage = ({
  header,
  loading,
  pending,
  template,
  listing,
  listingSummary,
  checks,
  guideRow,
  changelogField,
  termsBar,
  publishButton,
  reviewPanel,
  liveActionsElsewhere = false,
  extra,
  previewCard,
  contents,
}: IPublishTimelineProps) => {
  const { t } = useTranslation('space');
  const live = isTemplateLive(template);
  const checkRows = checks ?? (guideRow && <li className="p-3">{guideRow}</li>);

  if (loading || pending) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="shrink-0 border-b px-6 py-4">{header}</div>
        <div className="flex max-w-2xl flex-col gap-3 px-6 py-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background @container">
      <div className="shrink-0 border-b px-6 py-4">{header}</div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {/* Fields stand on the page, grouped by heading and space; only the checks' lines sit in
                a box, which their dividers need. */}
            <div className="flex max-w-2xl flex-col gap-6">
              <ListingSection summary={listingSummary} fields={listing} />
              {checkRows && (
                <section className="flex flex-col gap-2">
                  <h3 className={SECTION_TITLE}>{t('publishBase.checksTitle')}</h3>
                  <ul className="divide-y overflow-clip rounded-lg border bg-background">
                    {checkRows}
                  </ul>
                </section>
              )}
              {changelogField}
              {(!live || !liveActionsElsewhere) && reviewPanel}
              {extra}
            </div>
          </div>
          {/* Fixed at the foot of the column, however long what is above it runs. */}
          <div className="shrink-0 border-t px-6 py-3">
            <div className="flex max-w-2xl flex-wrap items-center gap-2">
              {termsBar}
              <div className="ms-auto">{publishButton}</div>
            </div>
          </div>
        </div>
        <aside className="hidden w-[380px] shrink-0 flex-col gap-4 overflow-y-auto border-s bg-muted p-5 @[760px]:flex">
          {previewCard}
          {contents}
        </aside>
      </div>
    </div>
  );
};
