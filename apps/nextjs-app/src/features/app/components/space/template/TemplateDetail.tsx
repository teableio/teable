import { useMutation, useQuery } from '@tanstack/react-query';
import {
  createBaseFromTemplate,
  getPublishedTemplateCategoryList,
  getTemplateDetail,
} from '@teable/openapi';
import { MarkdownPreview, useTables } from '@teable/sdk';
import { ReactQueryKeys } from '@teable/sdk/config/react-query-keys';
import { useIsMobile } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Badge, Button } from '@teable/ui-lib/shadcn';
import { ArrowUpRight, ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
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

  const categoryName = useMemo(() => {
    return categoryList?.find((c) => c.id === categoryId)?.name;
  }, [categoryList, categoryId]);

  const router = useRouter();
  const spaceId = useSpaceId();
  const routerBaseId = router.query.baseId as string | undefined;
  const tables = useTables();

  const { mutateAsync: createTemplateToBase, isLoading } = useMutation({
    mutationFn: () =>
      createBaseFromTemplate({
        spaceId: spaceId as string,
        templateId,
        withRecords: true,
        baseId: routerBaseId,
      }),
    onSuccess: (res) => {
      const { id: baseId } = res.data;
      if (routerBaseId && tables.length > 0) {
        router.push(`/base/${baseId}/table/${tables[0].id}`);
        return;
      }
      router.push(`/base/${baseId}`);
    },
  });

  if (isMobile) {
    return (
      <div className="absolute inset-0 flex size-full flex-col rounded bg-background">
        <div className="flex items-center gap-2 px-6 py-3 pr-9">
          <Button className="h-auto p-0 font-normal" variant="link" onClick={onBackToTemplateList}>
            <ChevronLeft className="size-6" />
          </Button>
          <h1 className="z-10 truncate bg-background text-lg font-bold">
            {name}
            {name}
            {name}
            {name}
          </h1>
          <Badge variant="secondary" className="text-xs font-normal text-muted-foreground">
            {categoryName}
          </Badge>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto px-6 pb-3">
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
            {!markdownDescription && (
              <span className="self-center text-sm text-gray-500">{t('common:noDescription')}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex size-full flex-col rounded bg-background">
      <div className="flex px-6 py-3 pr-14">
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center gap-4">
            <Button
              className="h-auto p-0 font-normal"
              variant="link"
              onClick={onBackToTemplateList}
            >
              <ChevronLeft className="size-6" />
            </Button>
            <h1 className="z-10 bg-background text-lg font-bold">{name}</h1>
            <Badge variant="secondary" className="text-xs font-normal text-muted-foreground">
              {categoryName}
            </Badge>
          </div>
          <p className="overflow-hidden text-wrap break-words pl-10 text-base font-normal text-muted-foreground">
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
      <div className="flex flex-1 flex-col gap-8 overflow-y-auto px-10 py-6">
        <TemplatePreview detail={templateDetail} />
        <div className="flex flex-col gap-1 pb-2">
          {markdownDescription && (
            <MarkdownPreview className="p-0">{markdownDescription}</MarkdownPreview>
          )}
          {!markdownDescription && (
            <span className="self-center text-sm text-gray-500">{t('common:noDescription')}</span>
          )}
        </div>
      </div>
    </div>
  );
};
