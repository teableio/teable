import { useMutation, useQuery } from '@tanstack/react-query';
import type { BaseNodeResourceType } from '@teable/openapi';
import {
  createBaseFromTemplate,
  getPublishedTemplateCategoryList,
  getTemplateDetail,
} from '@teable/openapi';
import { MarkdownPreview } from '@teable/sdk';
import { ReactQueryKeys } from '@teable/sdk/config/react-query-keys';
import { useIsMobile } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Badge, Button, cn } from '@teable/ui-lib/shadcn';
import { ArrowUpRight, ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { getNodeUrl } from '../../../blocks/base/base-node/hooks';
import { useSpaceId } from './hooks/use-space-id';
import { TemplatePreview } from './TemplatePreview';
import { TemplatePreviewSheet } from './TemplatePreviewSheet';

interface ITemplateDetailProps {
  templateId: string;
  onBackToTemplateList?: () => void;
}
export const TemplateDetail = (props: ITemplateDetailProps) => {
  const { templateId, onBackToTemplateList } = props;
  const { t } = useTranslation(['common']);
  const isMobile = useIsMobile();
  const { data: templateDetail } = useQuery({
    queryKey: ReactQueryKeys.templateDetail(templateId),
    queryFn: () => getTemplateDetail(templateId).then((res) => res.data),
  });

  const { name, description, categoryId, markdownDescription, cover } = templateDetail || {};

  const { data: categoryList } = useQuery({
    queryKey: ReactQueryKeys.publishedTemplateCategoryList(),
    queryFn: () => getPublishedTemplateCategoryList().then((data) => data.data),
  });

  const categoryNames = useMemo(() => {
    if (!categoryId || categoryId.length === 0) return [];
    return categoryList?.filter((c) => categoryId.includes(c.id)).map((c) => c.name) || [];
  }, [categoryList, categoryId]);

  const router = useRouter();
  const spaceId = useSpaceId();
  const routerBaseId = router.query.baseId as string | undefined;

  const { mutateAsync: createTemplateToBase, isLoading } = useMutation({
    mutationFn: () =>
      createBaseFromTemplate({
        spaceId: spaceId as string,
        templateId,
        withRecords: true,
        baseId: routerBaseId,
      }),
    onSuccess: (res) => {
      const { id: baseId, defaultActiveNodeId, defaultActiveNodeResourceType } = res.data;

      // Priority 1: If defaultActiveNodeId is provided, navigate to that specific node
      if (defaultActiveNodeId && defaultActiveNodeResourceType) {
        const nodeUrl = getNodeUrl({
          baseId,
          resourceType: defaultActiveNodeResourceType as BaseNodeResourceType,
          resourceId: defaultActiveNodeId,
        });
        if (nodeUrl) {
          router.push(nodeUrl);
          return;
        }
      }
    },
  });

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
        <div className="flex flex-col gap-3 overflow-y-auto px-6 pb-3">
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
            {/* {!markdownDescription && (
              <span className="self-center text-sm text-gray-500">{t('common:noDescription')}</span>
            )} */}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex size-full flex-col rounded bg-background">
      <div className="flex gap-3 px-6 py-3 pr-14">
        <div className="flex flex-1 flex-col gap-1 overflow-hidden">
          <div className="flex items-center gap-4">
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
            {categoryNames.length > 0 &&
              categoryNames.map((name) => (
                <Badge
                  variant="secondary"
                  className="text-xs font-normal text-muted-foreground"
                  key={name}
                >
                  {name}
                </Badge>
              ))}
          </div>
          <p
            className={cn(
              'overflow-hidden text-wrap break-words pl-10 text-base font-normal text-muted-foreground',
              {
                'pl-0': !onBackToTemplateList,
              }
            )}
          >
            {description}
          </p>
        </div>
        <Button
          size="sm"
          className="my-3"
          onClick={() => createTemplateToBase()}
          disabled={isLoading}
        >
          {t('common:settings.templateAdmin.useTemplate')}
          {isLoading && <Spin className="size-3" />}
        </Button>
      </div>
      <div className="flex flex-1 flex-col gap-8 overflow-y-auto px-10 py-6 2xl:flex-row">
        <TemplatePreview detail={templateDetail} className="2xl:h-fit 2xl:min-w-0 2xl:flex-1" />
        <div className="flex flex-col gap-1 pb-2 2xl:w-1/3 2xl:shrink-0">
          {markdownDescription && (
            <MarkdownPreview className="p-0">{markdownDescription}</MarkdownPreview>
          )}
          {/* {!markdownDescription && (
            <span className="self-center text-sm text-gray-500">{t('common:noDescription')}</span>
          )} */}
        </div>
      </div>
    </div>
  );
};
