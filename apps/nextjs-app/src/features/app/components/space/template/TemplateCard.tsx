import { Eye } from '@teable/icons';
import type { ITemplateVo } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'react-i18next';
import type { ITemplateBaseProps } from './TemplateMain';

interface ITemplateCardProps extends Pick<ITemplateBaseProps, 'onClickTemplateCardHandler'> {
  template: ITemplateVo;
  size: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
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
}: ITemplateCardProps) => {
  const { name, description, cover, visitCount, id: templateId } = template;
  const { presignedUrl } = cover ?? {};
  const { t, i18n } = useTranslation(['common']);

  const formatCount = (count: number) =>
    Intl.NumberFormat([i18n.language, 'en'], { notation: 'compact' }).format(count);

  return (
    <div
      className={cn('relative flex w-full shrink-0 cursor-pointer flex-col', className)}
      role="button"
      tabIndex={0}
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
          'group w-full shrink-0 overflow-hidden rounded-lg border bg-secondary p-0 transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.08),0_3px_6px_-2px_rgba(0,0,0,0.08)]',
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
      </div>

      <div
        className={cn('flex flex-1 flex-col gap-1 px-1 pt-2 text-base', {
          'text-sm pt-1 gap-0.5': size === 'xs',
        })}
      >
        <h2
          className={cn('flex items-center justify-between gap-3', {
            'gap-2': size === 'xs',
          })}
        >
          <span className="truncate font-medium" title={name}>
            {name}
          </span>

          <div
            className={cn('flex shrink-0 items-center gap-2 text-muted-foreground text-sm', {
              'text-xs gap-1': size === 'xs',
            })}
          >
            <Eye className="size-4" />
            <span>{formatCount(visitCount)}</span>
          </div>
        </h2>
        <p
          className={cn('m-0 flex-1 overflow-hidden truncate text-muted-foreground text-sm', {
            'text-xs': size === 'xs',
          })}
          title={description}
        >
          {description}
        </p>
      </div>
    </div>
  );
};
