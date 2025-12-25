import { useQuery } from '@tanstack/react-query';
import { Eye } from '@teable/icons';
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

  return filteredTemplates && filteredTemplates?.length > 0 ? (
    <div className={cn('flex flex-col items-start justify-start gap-3 self-stretch', className)}>
      <p className="text-base font-semibold text-foreground">
        {t('settings.templateAdmin.relatedTemplates')}
      </p>
      <div className="flex flex-col items-start justify-start gap-4 self-stretch md:flex-row">
        {filteredTemplates?.map((template) => (
          <div
            key={template.id}
            className="group relative flex h-64 w-full flex-col items-start justify-start bg-background transition-shadow focus:outline-none md:max-w-[33%] md:flex-1"
          >
            <div
              className="relative h-[218px] w-full cursor-pointer self-stretch overflow-hidden rounded-lg border border-border bg-secondary hover:shadow-md"
              onClick={() => handleTemplateClick(template.id)}
              onKeyDown={(e) => handleKeyDown(e, template.id)}
              role="button"
              tabIndex={0}
            >
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
            <div className="flex flex-col items-start justify-center gap-0.5 self-stretch border-border bg-background px-1 pt-1">
              <div className="relative flex items-start justify-start gap-1 self-stretch">
                <p
                  className="w-full truncate text-sm font-medium text-foreground"
                  title={template.name}
                >
                  {template.name}{' '}
                </p>
                <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                  <Eye className="size-4" />
                  <span>{template.visitCount > 999 ? '999+' : template.visitCount}</span>
                </div>
              </div>
              <div
                className="w-full truncate text-sm text-muted-foreground"
                title={template.description}
              >
                {template.description}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null;
};
