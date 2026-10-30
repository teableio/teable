import { Eye } from '@teable/icons';
import type { ITemplateVo } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { TemplateHostContext } from './host-context';
import type { ITemplateBaseProps } from './TemplateMain';

interface ITemplateCardProps extends Pick<ITemplateBaseProps, 'onClickTemplateCardHandler'> {
  template: ITemplateVo;
  size: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  /** PostHog autocapture marker (autocapture is allowlisted to `[data-attr]` elements). */
  dataAttr?: string;
  /** Its place in this month's ranking, shown on the cover. */
  rank?: number;
}

const AspectRatioMap = {
  xs: 'aspect-[16/10]',
  sm: 'aspect-[16/10]',
  md: 'aspect-[16/9]',
  lg: 'aspect-[16/9]',
};

export const TemplateCard = ({
  template,
  onClickTemplateCardHandler,
  size = 'sm',
  className,
  dataAttr,
  rank,
}: ITemplateCardProps) => {
  const { name, cover, visitCount, id: templateId, createdBy, description } = template;
  const { presignedUrl } = cover ?? {};
  const { t, i18n } = useTranslation(['common']);
  const host = useContext(TemplateHostContext);
  const coverOverlay = host.renderCoverOverlay?.(template);
  const footer = host.renderCardFooter?.(template);

  const formatCount = (count: number) =>
    Intl.NumberFormat([i18n.language, 'en'], { notation: 'compact' }).format(count);

  return (
    <div
      className={cn('relative flex w-full shrink-0 cursor-pointer flex-col', className)}
      role="button"
      tabIndex={0}
      data-attr={dataAttr}
      onClick={(e) => {
        e.stopPropagation();
        onClickTemplateCardHandler?.(templateId);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          onClickTemplateCardHandler?.(templateId);
        }
      }}
    >
      <div
        className={cn(
          'group relative w-full shrink-0 overflow-hidden rounded-lg border bg-secondary p-0 transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.08),0_3px_6px_-2px_rgba(0,0,0,0.08)]',
          AspectRatioMap[size]
        )}
      >
        {presignedUrl ? (
          <img
            src={presignedUrl}
            className="size-full object-cover transition-all duration-300 group-hover:scale-105"
            alt="preview"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <span className="text-sm text-muted-foreground">
              {t('settings.templateAdmin.noImage')}
            </span>
          </div>
        )}
        {coverOverlay && (
          <div
            className={cn('absolute bottom-2 start-2', {
              'bottom-1.5 start-1.5': size === 'xs',
            })}
          >
            {coverOverlay}
          </div>
        )}
        {rank && (
          <span className="absolute start-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium text-foreground">
            {t('template.rankThisMonth', { rank })}
          </span>
        )}
      </div>

      <div
        className={cn('flex flex-1 flex-col gap-1 px-1 pt-2 text-base', {
          'text-sm pt-1 gap-0.5': size === 'xs',
        })}
      >
        <h2 className="truncate font-medium" title={name}>
          {name}
        </h2>
        <p
          className={cn('m-0 line-clamp-2 text-sm text-muted-foreground', {
            'text-xs line-clamp-1': size === 'xs',
          })}
          title={description}
        >
          {description}
        </p>
        {size !== 'xs' && (
          <div className="mt-auto flex items-center justify-between gap-3 pt-1 text-xs text-muted-foreground">
            {footer ?? (
              <>
                <span className="truncate">{createdBy?.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <Eye className="size-3.5" />
                  <span>{formatCount(visitCount)}</span>
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
