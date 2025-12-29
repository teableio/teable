import { Eye } from '@teable/icons';
import type { ITemplateVo } from '@teable/openapi';
import { useTranslation } from 'react-i18next';
import type { ITemplateBaseProps } from './TemplateMain';

interface ITemplateCardProps extends ITemplateBaseProps {
  template: ITemplateVo;
}

export const TemplateCard = ({ template, onClickTemplateCardHandler }: ITemplateCardProps) => {
  const { name, description, cover, visitCount, id: templateId } = template;
  const { presignedUrl } = cover ?? {};
  const { t } = useTranslation(['common']);

  return (
    <div
      className="relative flex w-full shrink-0 cursor-pointer flex-col"
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
      <div className="group h-[180px] w-auto shrink-0 overflow-hidden rounded-lg border bg-secondary p-0 transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(0,0,0,0.08),0_3px_6px_-2px_rgba(0,0,0,0.08)]">
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

      <div className="flex flex-1 flex-col gap-1 px-1 pt-2">
        <h2 className="flex items-center justify-between text-base">
          <span className="truncate font-medium" title={name}>
            {name}
          </span>

          <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            <Eye className="size-4" />
            <span>{visitCount > 999 ? '999+' : visitCount}</span>
          </div>
        </h2>
        <p
          className="m-0 flex-1 overflow-hidden truncate text-sm text-muted-foreground"
          title={description}
        >
          {description}
        </p>
      </div>
    </div>
  );
};
