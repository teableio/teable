import { ArrowRight } from '@teable/icons';
import type { ITemplateVo } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useBrand } from '@/features/app/hooks/useBrand';
import type { ITemplateBaseProps } from './TemplateMain';

interface ITemplateCardProps extends ITemplateBaseProps {
  template: ITemplateVo;
}

export const TemplateCard = ({ template, onClickTemplateCardHandler }: ITemplateCardProps) => {
  const { name, description, cover, usageCount, id: templateId } = template;
  const { presignedUrl } = cover ?? {};
  const { t } = useTranslation('common');
  const { brandName } = useBrand();

  return (
    <div
      className="group relative flex h-[318px] w-full shrink-0 cursor-pointer flex-col overflow-hidden rounded-lg border p-0 transition-shadow hover:shadow-lg"
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
      <div className="h-[180px] w-auto shrink-0 bg-secondary">
        {presignedUrl && (
          <img
            src={presignedUrl}
            className="size-full object-cover transition-all duration-300 group-hover:scale-105"
            alt="preview"
          />
        )}
      </div>

      <div className="flex flex-1 flex-col px-4 pt-4">
        <h2 className="mb-3 flex items-center text-base font-semibold">
          <span className="truncate" title={name}>
            {name}
          </span>
          <span className="inline-block shrink-0 transition-transform group-hover:translate-x-1 motion-reduce:transform-none">
            <ArrowRight />
          </span>
        </h2>
        <p
          className="m-0 line-clamp-2 flex-1 overflow-hidden text-sm text-gray-500"
          title={description}
        >
          {description}
        </p>
        <p className="my-3 flex justify-between truncate text-sm text-gray-500">
          <span className="truncate">
            {t('settings.templateAdmin.createdBy', { user: brandName })}
          </span>
          <span className="shrink-0">
            {t('settings.templateAdmin.usageCount', { count: usageCount })}
          </span>
        </p>
      </div>
    </div>
  );
};
