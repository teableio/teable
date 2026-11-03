import { MoreHorizontal, Table2 } from '@teable/icons';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
  HoverCard,
  HoverCardContent,
  HoverCardPortal,
  HoverCardTrigger,
} from '@teable/ui-lib';
import type { ReactElement } from 'react';
import { Fragment } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useContentDir } from '../../hooks/use-content-dir';
import type { IExpandRecordCrumb } from './PanelContext';

// beyond this many levels the middle ones fold into an ellipsis, keeping the first and the last;
// each level is at most max-w-36 (144px) wide
// eslint-disable-next-line @typescript-eslint/naming-convention
const MAX_VISIBLE_CRUMBS = 3;

const CrumbCard = ({ crumb, children }: { crumb: IExpandRecordCrumb; children: ReactElement }) => {
  const { t } = useTranslation();
  const contentDir = useContentDir();
  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent align="start" className="w-auto min-w-48 max-w-72 space-y-1 p-3">
          <p dir={contentDir} className="line-clamp-2 break-words text-sm font-medium">
            {crumb.title || t('common.untitled')}
          </p>
          {crumb.tableName && (
            <button
              dir={contentDir}
              className="-mx-1 flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground"
              disabled={!crumb.openTable}
              onClick={crumb.openTable}
            >
              <Table2 className="size-3.5 shrink-0" />
              <span className="truncate">{crumb.tableName}</span>
            </button>
          )}
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
};

/**
 * The records open on the way to the one on top, outermost first. Each but the last goes back to
 * that record; hovering one shows its full title and table.
 */
export const ExpandRecordBreadcrumb = ({ crumbs }: { crumbs: IExpandRecordCrumb[] }) => {
  const { t } = useTranslation();
  const contentDir = useContentDir();
  const last = crumbs.length - 1;
  // going back to a record closes the one stacked right over it, and with it everything above
  const goTo = (index: number) => crumbs[index + 1]?.close?.();
  const folds = crumbs.length > MAX_VISIBLE_CRUMBS;
  const visible = folds ? [0, last] : crumbs.map((_, index) => index);
  const folded = folds ? crumbs.slice(1, last).map((crumb, i) => ({ crumb, index: i + 1 })) : [];

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap gap-1 sm:gap-1">
        {visible.map((index, position) => {
          const crumb = crumbs[index];
          const label = crumb.title || t('common.untitled');
          return (
            <Fragment key={index}>
              {position > 0 && <BreadcrumbSeparator />}
              {position === 1 && folded.length > 0 && (
                <>
                  <BreadcrumbItem>
                    {/* the folded levels, as a breadcrumb of their own in a card */}
                    <HoverCard openDelay={100} closeDelay={150}>
                      <HoverCardTrigger asChild>
                        <button
                          className="flex size-6 items-center justify-center rounded hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                          aria-label={t('expandRecord.showMore')}
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      </HoverCardTrigger>
                      <HoverCardPortal>
                        <HoverCardContent align="start" className="w-auto max-w-96 px-2 py-1.5">
                          <Breadcrumb>
                            <BreadcrumbList className="flex-nowrap gap-1 sm:gap-1">
                              {folded.map(({ crumb: hidden, index: hiddenIndex }, i) => (
                                <Fragment key={hiddenIndex}>
                                  {i > 0 && <BreadcrumbSeparator />}
                                  <BreadcrumbItem className="min-w-0">
                                    <CrumbCard crumb={hidden}>
                                      <button
                                        dir={contentDir}
                                        className="max-w-36 truncate rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
                                        onClick={() => goTo(hiddenIndex)}
                                      >
                                        {hidden.title || t('common.untitled')}
                                      </button>
                                    </CrumbCard>
                                  </BreadcrumbItem>
                                </Fragment>
                              ))}
                            </BreadcrumbList>
                          </Breadcrumb>
                        </HoverCardContent>
                      </HoverCardPortal>
                    </HoverCard>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </>
              )}
              {/* short of room, the records on the way give way first and the open one last */}
              <BreadcrumbItem className={index === last ? 'min-w-0' : 'min-w-10 shrink-[8]'}>
                <CrumbCard crumb={crumb}>
                  {index === last ? (
                    <span
                      dir={contentDir}
                      aria-current="page"
                      className="max-w-36 truncate px-1 text-foreground"
                    >
                      {label}
                    </span>
                  ) : (
                    <button
                      dir={contentDir}
                      className="max-w-36 truncate rounded px-1 hover:bg-accent hover:text-foreground"
                      onClick={() => goTo(index)}
                    >
                      {label}
                    </button>
                  )}
                </CrumbCard>
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
};
