import { ArrowRight, Heart } from '@teable/icons';
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
      className="group relative flex h-[308px] w-full shrink-0 cursor-pointer flex-col overflow-hidden rounded-lg border p-0 transition-shadow hover:shadow-lg"
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
        <h2 className="mb-2 flex items-center justify-between text-base">
          <span className="truncate font-semibold" title={name}>
            {name}
          </span>

          <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            <Heart className="size-4" />
            <span>{usageCount > 999 ? '999+' : usageCount}</span>
          </div>
        </h2>
        <p className="m-0 line-clamp-2 flex-1 overflow-hidden text-sm " title={description}>
          {description}
        </p>
      </div>
    </div>
  );
};
