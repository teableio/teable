import { useQuery } from '@tanstack/react-query';
import { getPublishedTemplateList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config/react-query-keys';
import { Spin } from '@teable/ui-lib/base';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';

interface IRecommendTemplateProps {
  filterTemplateIds?: string[];
  onTemplateClick?: (templateId: string) => void;
  className?: string;
}

export const RecommendTemplate = (props: IRecommendTemplateProps) => {
  const { onTemplateClick, className, filterTemplateIds } = props;
  const { t } = useTranslation('common');

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

  const handleTemplateClick = (templateId: string) => {
    onTemplateClick?.(templateId);
  };

  const handleKeyDown = (e: React.KeyboardEvent, templateId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleTemplateClick(templateId);
    }
  };

  return (
    <div className={cn('flex flex-col items-start justify-start gap-3 self-stretch', className)}>
      <p className="text-base font-semibold text-foreground">
        {t('settings.templateAdmin.relatedTemplates')}
      </p>
      <div className="flex flex-col items-start justify-start gap-4 self-stretch md:flex-row">
        {filteredTemplates?.map((template) => (
          <div
            key={template.id}
            role="button"
            tabIndex={0}
            className="group relative flex h-64 w-full cursor-pointer flex-col items-start justify-start overflow-hidden rounded-lg border border-border bg-background transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 md:max-w-[33%] md:flex-1"
            onClick={() => handleTemplateClick(template.id)}
            onKeyDown={(e) => handleKeyDown(e, template.id)}
          >
            <div className="relative h-[218px] w-full self-stretch overflow-hidden bg-secondary">
              {template.cover?.presignedUrl ? (
                <img
                  src={template.cover.presignedUrl}
                  alt={template.name}
                  className="size-full object-cover transition-all duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <span className="text-sm text-muted-foreground">
                    {t('settings.templateAdmin.noImage')}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-col items-start justify-center gap-2 self-stretch border-t border-border bg-background p-3">
              <div className="relative flex flex-col items-start justify-start gap-1 self-stretch">
                <p className="w-full truncate text-sm font-medium text-foreground">
                  {template.name}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
