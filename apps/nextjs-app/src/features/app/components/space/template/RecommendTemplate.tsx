import { useQuery } from '@tanstack/react-query';
import { getPublishedTemplateList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config/react-query-keys';
import { useIsMobile } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { TemplateCard } from './TemplateCard';
import type { ITemplateBaseProps } from './TemplateMain';

interface IRecommendTemplateProps extends Pick<ITemplateBaseProps, 'onClickTemplateCardHandler'> {
  filterTemplateIds?: string[];
  onClickTemplateCardHandler?: (templateId: string) => void;
  className?: string;
}

export const RecommendTemplate = (props: IRecommendTemplateProps) => {
  const { onClickTemplateCardHandler, className, filterTemplateIds } = props;
  const { t } = useTranslation('common');
  const isMobile = useIsMobile();

  const { data: templates, isLoading } = useQuery({
    queryKey: [...ReactQueryKeys.publishedTemplateList(null, '', true), 'recommend'],
    queryFn: () => getPublishedTemplateList({ featured: true, take: 4 }).then((res) => res.data),
  });

  const filteredTemplates = useMemo(() => {
    return templates?.filter((template) => !filterTemplateIds?.includes(template.id))?.slice(0, 3);
  }, [templates, filterTemplateIds]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spin className="size-6" />
      </div>
    );
  }

  if (!templates || templates.length === 0) {
    return null;
  }

  return filteredTemplates && filteredTemplates?.length > 0 ? (
    <div className={cn('flex flex-col items-start justify-start gap-3 self-stretch', className)}>
      <p className="text-base font-semibold text-foreground">
        {t('settings.templateAdmin.relatedTemplates')}
      </p>
      <div
        className={cn('grid w-full grid-cols-3 gap-5', {
          'grid-cols-1': isMobile,
        })}
      >
        {filteredTemplates?.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            size="lg"
            onClickTemplateCardHandler={onClickTemplateCardHandler}
          />
        ))}
      </div>
    </div>
  ) : null;
};
