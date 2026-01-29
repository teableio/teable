import { useMutation, useQuery } from '@tanstack/react-query';
import {
  createBaseFromTemplate,
  getTemplateCategoryList,
  getTemplateDetail,
} from '@teable/openapi';
import { MarkdownPreview } from '@teable/sdk';
import { ReactQueryKeys } from '@teable/sdk/config/react-query-keys';
import { useIsMobile } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Badge, Button, cn, useToast } from '@teable/ui-lib/shadcn';
import { ArrowUpRight, ChevronLeft, Share2 } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useRef } from 'react';
import { useSpaceId } from './hooks/use-space-id';
import { RecommendTemplate } from './RecommendTemplate';
import { TemplatePreview } from './TemplatePreview';
import { TemplatePreviewSheet } from './TemplatePreviewSheet';

interface ITemplateDetailProps {
  templateId: string;
  onBackToTemplateList?: () => void;
  onTemplateClick?: (templateId: string) => void;
}
export const TemplateDetail = (props: ITemplateDetailProps) => {
  const { templateId, onBackToTemplateList, onTemplateClick } = props;
  const { t } = useTranslation(['common']);
  const detailRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { data: _templateDetail } = useQuery({
    queryKey: ReactQueryKeys.templateDetail(templateId),
    queryFn: () => getTemplateDetail(templateId).then((res) => res.data),
  });

  const templateDetail = _templateDetail?.id === templateId ? _templateDetail : undefined;

  const { name, description, categoryId, markdownDescription, cover } = templateDetail || {};

  const { data: categoryList } = useQuery({
    queryKey: ReactQueryKeys.publishedTemplateCategoryList(),
    queryFn: () => getTemplateCategoryList().then((data) => data.data),
  });

  const categoryNames = useMemo(() => {
    if (!categoryId || categoryId.length === 0) return [];
    return categoryList?.filter((c) => categoryId.includes(c.id)).map((c) => c.name) || [];
  }, [categoryList, categoryId]);

  const router = useRouter();
  const spaceId = useSpaceId();
  const routerBaseId = router.query.baseId as string | undefined;

  const { mutateAsync: createTemplateToBase, isPending: isLoading } = useMutation({
    mutationFn: () =>
      createBaseFromTemplate({
        spaceId: spaceId as string,
        templateId,
        withRecords: true,
        baseId: routerBaseId,
      }),
    onSuccess: (res) => {
      const { id: baseId, defaultUrl } = res.data;

      // If defaultUrl is provided, navigate to it directly
      if (defaultUrl) {
        router.push(defaultUrl);
        return;
      }

      // Otherwise, navigate to base home
      router.push({
        pathname: '/base/[baseId]',
        query: { baseId },
      });
    },
  });

  const filterTemplateIds = useMemo(() => {
    return [templateId];
  }, [templateId]);

  const handleCopyPermalink = () => {
    const permalink = `${window.location.origin}/t/${templateId}`;
    navigator.clipboard.writeText(permalink);
    toast({
      title: t('common:template.non.copy'),
    });
  };

  useEffect(() => {
    if (detailRef.current) {
      detailRef.current.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  }, [templateId]);

  if (isMobile) {
    return (
      <div className="absolute inset-0 flex size-full flex-col rounded bg-background">
        <div className="flex items-center gap-2 px-6 py-3 pr-9">
          {onBackToTemplateList && (
            <Button
              className="h-auto p-0 font-normal"
              variant="link"
              onClick={onBackToTemplateList}
            >
              <ChevronLeft className="size-6" />
            </Button>
          )}
          <h1 className="truncate bg-background text-lg font-bold">{name}</h1>
        </div>
        <div ref={detailRef} className="flex flex-col gap-3 overflow-y-auto px-6 pb-3">
          {categoryNames.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {categoryNames.map((categoryName) => (
                <Badge
                  key={categoryName}
                  variant="secondary"
                  className="text-xs font-normal text-muted-foreground"
                >
                  {categoryName}
                </Badge>
              ))}
            </div>
          )}
          <p className="text-base font-normal text-muted-foreground">{description}</p>
          <div className="flex gap-2">
            <TemplatePreviewSheet detail={templateDetail}>
              <Button className="flex-1" variant="outline" size="xs">
                <ArrowUpRight className="size-3" />
                {t('common:settings.templateAdmin.actions.preview')}
              </Button>
            </TemplatePreviewSheet>
            <Button className="flex-1" variant="outline" size="xs" onClick={handleCopyPermalink}>
              <Share2 className="size-3" />
              {t('common:template.non.share')}
            </Button>
            <Button
              className="flex-1"
              size="xs"
              onClick={() => createTemplateToBase()}
              disabled={isLoading}
            >
              {t('common:settings.templateAdmin.useTemplate')}
              {isLoading && <Spin className="size-3" />}
            </Button>
          </div>
          {cover?.presignedUrl && (
            <div className="rounded-md border ">
              <img
                src={cover?.presignedUrl}
                alt={name}
                className="w-full rounded-md  object-contain"
              />
            </div>
          )}
          <div className="flex flex-col gap-1 pb-2">
            {markdownDescription && (
              <MarkdownPreview className="p-0">{markdownDescription}</MarkdownPreview>
            )}
          </div>
          <RecommendTemplate
            filterTemplateIds={filterTemplateIds}
            onClickTemplateCardHandler={onTemplateClick}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex size-full flex-col rounded bg-background">
      <div className="flex gap-3 border-b px-6 py-4 pr-12">
        <div className="flex flex-1 flex-col gap-1 overflow-hidden">
          <div className="flex items-center gap-3">
            {onBackToTemplateList && (
              <Button
                className="h-auto p-0 font-normal"
                variant="link"
                onClick={onBackToTemplateList}
              >
                <ChevronLeft className="size-6" />
              </Button>
            )}
            <h1 className="truncate text-lg font-semibold">{name}</h1>
            <div className="flex gap-2">
              {categoryNames.length > 0 &&
                categoryNames.map((name) => (
                  <Badge
                    variant="secondary"
                    className="px-2 text-xs font-normal text-muted-foreground"
                    key={name}
                  >
                    {name}
                  </Badge>
                ))}
            </div>
          </div>
          <p
            className={cn(
              'overflow-hidden text-wrap break-words pl-9 text-sm font-normal text-muted-foreground',
              {
                'pl-0': !onBackToTemplateList,
              }
            )}
          >
            {description}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleCopyPermalink}>
            <Share2 className="size-4" />
            {t('common:template.non.share')}
          </Button>
          <Button size="sm" onClick={() => createTemplateToBase()} disabled={isLoading}>
            {t('common:settings.templateAdmin.useTemplate')}
            {isLoading && <Spin className="size-3" />}
          </Button>
        </div>
      </div>
      <div
        ref={detailRef}
        className="flex flex-1 flex-col gap-8 overflow-y-auto bg-muted px-10 py-6"
      >
        <TemplatePreview detail={templateDetail} />
        {markdownDescription && (
          <div className="flex flex-col gap-1 pb-2">
            <MarkdownPreview className="p-0">{markdownDescription}</MarkdownPreview>
          </div>
        )}
        <RecommendTemplate
          filterTemplateIds={filterTemplateIds}
          onClickTemplateCardHandler={onTemplateClick}
        />
      </div>
    </div>
  );
};
