'use client';
import { useQuery } from '@tanstack/react-query';
import type { ITemplateVo } from '@teable/openapi';
import { getBaseById } from '@teable/openapi';
import {
  cn,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@teable/ui-lib';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useState, useEffect } from 'react';
import { TemplateModal } from '../../components/space/template';
import { TemplateContext } from '../../components/space/template/context';
import { TemplateCard } from '../../components/space/template/TemplateCard';
import { TemplateDetail } from '../../components/space/template/TemplateDetail';

interface ITemplateCategoryListVo {
  id: string;
  name: string;
  order: number;
}

interface TemplateCategory extends ITemplateCategoryListVo {
  image?: string;
}

export interface TemplateType extends ITemplateVo {
  category?: TemplateCategory;
}

interface TemplateProps {
  initialTemplates: TemplateType[];
  categories: ITemplateCategoryListVo[];
}

export const Template: React.FC<TemplateProps> = ({ initialTemplates: templates, categories }) => {
  const [displayCount, setDisplayCount] = useState(4);
  const [hasMore, setHasMore] = useState(templates.length > 4);
  const [activeCategory, setActiveCategory] = useState('all');
  const { t } = useTranslation(['common', 'space']);
  const [open, setOpen] = useState(false);
  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(null);
  // Generate dynamic category filters based on actual data
  const categoryFilters = React.useMemo(() => {
    const baseCats = [{ id: 'all', name: 'All', icon: null }];

    const uniqueCategories = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
    }));

    return [...baseCats, ...uniqueCategories];
  }, [categories]);

  // Filter templates by category
  const filteredTemplates = React.useMemo(() => {
    if (activeCategory === 'all') {
      return templates;
    }
    return templates.filter((template) => template.categoryId === activeCategory);
  }, [templates, activeCategory]);

  // Load more templates
  const handleLoadMore = () => {
    // Increase display count by 4 (1 more row)
    const newCount = displayCount + 4;
    setDisplayCount(newCount);

    // Check if we've shown all templates
    if (newCount >= filteredTemplates.length) {
      setHasMore(false);
    }
  };

  const displayedTemplates = filteredTemplates.slice(0, displayCount);

  const router = useRouter();
  const baseId = router.query.baseId as string;

  const { data: baseInfo } = useQuery({
    queryKey: ['baseInfo', baseId],
    queryFn: () => getBaseById(baseId),
    enabled: !!baseId,
  });

  const spaceId = baseInfo?.data.spaceId as string;

  // Update hasMore when category changes
  useEffect(() => {
    setDisplayCount(4);
    setHasMore(filteredTemplates.length > 4);
  }, [activeCategory, filteredTemplates.length]);

  if (templates.length === 0) {
    return (
      <div className="flex w-full items-center justify-center py-20">
        <div className="text-center">
          <div className="mb-2 dark:text-zinc-400">{t('common:template.noTemplates')}</div>
        </div>
      </div>
    );
  }

  return (
    <TemplateContext.Provider value={{ spaceId }}>
      <div className="relative mx-auto flex w-full max-w-[1158px] flex-col items-center justify-start gap-2 p-4 sm:px-6 lg:px-8">
        {/* Title */}
        <div className="flex items-start justify-start self-stretch">
          <h1 className="text-2xl font-bold">{t('common:template.templateTitle')}</h1>
        </div>

        {/* Filter and Sort Header */}
        <div className="flex w-full shrink-0 grow-0 flex-col justify-around overflow-hidden sm:flex-row">
          {/* Category Filters */}
          <div className="flex flex-1 shrink-0 flex-wrap justify-start gap-1 overflow-auto">
            {categoryFilters.map((category) => (
              <Button
                key={category.id}
                variant="ghost"
                size="xs"
                onClick={() => setActiveCategory(category.id)}
                className={cn(
                  'flex justify-center items-center relative gap-1 px-3 py-2 rounded-lg border transition-all duration-200 text-card-foreground bg-card',
                  {
                    'text-card-foreground bg-secondary': activeCategory === category.id,
                  }
                )}
              >
                <p className="text-left text-xs">{category.name}</p>
              </Button>
            ))}
          </div>

          <TemplateModal spaceId={spaceId}>
            <Button variant="ghost" size="sm">
              <p className="shrink-0 grow-0 text-left text-xs">{t('common:template.browseAll')}</p>
            </Button>
          </TemplateModal>
        </div>

        {/* Templates Grid */}
        <div className="flex shrink-0 grow-0 flex-col items-start justify-start gap-5 self-stretch">
          <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {displayedTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onClickTemplateCardHandler={() => {
                  setCurrentTemplateId(template.id);
                  setOpen(true);
                }}
              />
            ))}
          </div>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="flex h-[85%] max-w-[80%] flex-col gap-y-1 p-0">
            <DialogHeader className="flex w-full border-b p-3">
              <DialogTitle>{t('space:template.title')}</DialogTitle>
              <DialogDescription>{t('space:template.description')}</DialogDescription>
            </DialogHeader>
            {currentTemplateId && <TemplateDetail templateId={currentTemplateId} />}
          </DialogContent>
        </Dialog>

        {/* Load More Button */}
        {hasMore && (
          <div className="flex shrink-0 grow-0 flex-col items-start justify-start">
            <Button size="sm" variant="ghost" onClick={handleLoadMore}>
              <p className="shrink-0 grow-0 text-left text-xs">{t('common:template.loadMore')}</p>
            </Button>
          </div>
        )}

        {!hasMore && filteredTemplates.length > 0 && (
          <div className="mt-4 text-center text-sm text-[#4c5564]">
            {t('common:template.allTemplatesLoaded')}
          </div>
        )}
      </div>
    </TemplateContext.Provider>
  );
};
