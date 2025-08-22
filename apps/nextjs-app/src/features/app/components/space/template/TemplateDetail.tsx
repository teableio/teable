import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from '@teable/icons';
import {
  createBaseFromTemplate,
  getPublishedTemplateCategoryList,
  getTemplateDetail,
} from '@teable/openapi';
import { MarkdownPreview, useTables } from '@teable/sdk';
import { ReactQueryKeys } from '@teable/sdk/config/react-query-keys';
import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useSpaceId } from './hooks/use-space-id';
interface ITemplateDetailProps {
  templateId: string;
  onBackToTemplateList?: () => void;
}
export const TemplateDetail = (props: ITemplateDetailProps) => {
  const { templateId, onBackToTemplateList } = props;
  const { t } = useTranslation(['common']);
  const { data: templateDetail } = useQuery({
    queryKey: ReactQueryKeys.templateDetail(templateId),
    queryFn: () => getTemplateDetail(templateId).then((res) => res.data),
  });

  const { cover, name, description, categoryId, markdownDescription } = templateDetail || {};

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

  return (
    <div className="mx-6 mt-2 flex flex-1 items-start justify-center overflow-auto">
      <div className="relative grid w-full grid-cols-8">
        <div className="sticky top-0 col-span-8 flex flex-col self-start pb-12 pr-8 sm:col-span-2 sm:pb-0">
          {onBackToTemplateList && (
            <div
              className="flex cursor-pointer items-center gap-1 pb-4 text-sm text-foreground transition-colors hover:text-foreground/80"
              role="button"
              tabIndex={0}
              onClick={() => onBackToTemplateList?.()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onBackToTemplateList?.();
                }
              }}
            >
              <ArrowLeft />
              {t('common:settings.templateAdmin.backToTemplateList')}
            </div>
          )}
          <h1 className="z-10 bg-background text-lg font-bold">{name}</h1>
          <p className="overflow-hidden text-wrap break-words text-base text-gray-500">
            {description}
          </p>
          <Button
            size="sm"
            className="my-3"
            onClick={() => createTemplateToBase()}
            disabled={isLoading}
          >
            {t('common:settings.templateAdmin.useTemplate')}
            {isLoading && <Spin className="size-3" />}
          </Button>
          {categoryName && <span className="py-1 text-sm text-gray-500"># {categoryName}</span>}
        </div>

        <div className="col-span-8 border-t pt-4 sm:col-span-5 sm:border-l sm:border-t-0 sm:pl-6">
          <div className="relative mb-8 max-w-screen-md overflow-hidden rounded-md shadow-xl sm:mb-14">
            {cover?.presignedUrl && (
              <img
                src={cover?.presignedUrl}
                alt={name}
                className="relative w-full max-w-screen-md object-cover dark:drop-shadow-[0_0_0.3rem_#ffffff70]"
              />
            )}
          </div>
          <div className="flex flex-col gap-1 pb-2">
            {markdownDescription && <MarkdownPreview>{markdownDescription}</MarkdownPreview>}
            {!markdownDescription && (
              <span className="self-center text-sm text-gray-500">{t('common:noDescription')}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
