import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createBaseFromTemplate,
  createShortLink,
  getTemplateCategoryList,
  getTemplateDetail,
  ShortLinkType,
} from '@teable/openapi';
import { MarkdownPreview } from '@teable/sdk';
import { ReactQueryKeys } from '@teable/sdk/config/react-query-keys';
import { useIsMobile, useContentDir, useLanDayjs } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Badge, Button, cn, useToast } from '@teable/ui-lib/shadcn';
import { ArrowUpRight, ChevronLeft, Share2 } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useContext, useEffect, useMemo, useRef } from 'react';
import { useOrigin } from '@/features/app/hooks/useOrigin';
import { useSpaceId } from './hooks/use-space-id';
import type { ITemplateInstallResult } from './host-context';
import { TemplateHostContext, TemplateHostInstallSource } from './host-context';
import { RecommendTemplate } from './RecommendTemplate';
import { TemplatePreview } from './TemplatePreview';
import { TemplatePreviewSheet } from './TemplatePreviewSheet';

interface ITemplateDetailProps {
  templateId: string;
  onBackToTemplateList?: () => void;
  onTemplateClick?: (templateId: string) => void;
  /** Takes over Install: the host that opened the detail (the chat's offer card) installs on its own terms. */
  onInstall?: (templateId: string) => void;
}
export const TemplateDetail = (props: ITemplateDetailProps) => {
  const contentDir = useContentDir();
  const { templateId, onBackToTemplateList, onTemplateClick, onInstall } = props;
  const { t } = useTranslation(['common']);
  const dayjs = useLanDayjs();
  const queryClient = useQueryClient();
  const detailRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { data: _templateDetail } = useQuery({
    queryKey: ReactQueryKeys.templateDetail(templateId),
    queryFn: () => getTemplateDetail(templateId).then((res) => res.data),
  });

  const templateDetail = _templateDetail?.id === templateId ? _templateDetail : undefined;
  const host = useContext(TemplateHostContext);
  const sidebarExtra = templateDetail ? host.renderDetailSidebar?.(templateDetail) : null;

  const { name, description, categoryId, markdownDescription, cover, version, usageCount } =
    templateDetail || {};
  const history = useMemo(() => [...(templateDetail?.history ?? [])].reverse(), [templateDetail]);
  const updatedTime = history[0]?.publishedTime;
  const author = templateDetail?.createdBy?.name;

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
    mutationFn: async (): Promise<ITemplateInstallResult | undefined> => {
      if (host.install) {
        return host.install({
          templateId,
          spaceId: spaceId as string,
          baseId: routerBaseId,
          source: TemplateHostInstallSource.Catalog,
          queryClient,
        });
      }
      const { data } = await createBaseFromTemplate({
        spaceId: spaceId as string,
        templateId,
        withRecords: true,
        baseId: routerBaseId,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      return { redirect: data.defaultUrl ?? `/base/${data.id}`, baseId: data.id };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseList(spaceId as string) });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
      if (res) router.push(res.redirect);
    },
  });

  const install = () => (onInstall ? onInstall(templateId) : createTemplateToBase());

  const filterTemplateIds = useMemo(() => {
    return [templateId];
  }, [templateId]);

  const origin = useOrigin();

  const handleCopyPermalink = async () => {
    const base = origin || window.location.origin;
    // Create the short link on demand; fall back to the /t permalink when the
    // template is not published or the request fails
    let permalink = `${base}/t/${templateId}`;
    try {
      const { data } = await createShortLink({
        type: ShortLinkType.Template,
        resourceId: templateId,
      });
      permalink = `${base}/s/${data.code}`;
    } catch {
      // keep the permalink fallback
    }
    await navigator.clipboard.writeText(permalink);
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

  const facts = (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <dt className="text-xs text-muted-foreground">{t('common:template.detail.installs')}</dt>
        <dd>{usageCount ?? 0}</dd>
      </div>
      {author && (
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{t('common:template.detail.author')}</dt>
          <dd className="truncate">{author}</dd>
        </div>
      )}
      {updatedTime && (
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{t('common:template.detail.updated')}</dt>
          <dd>
            {version ? `v${version} · ` : ''}
            {dayjs(updatedTime).format('YYYY-MM-DD')}
          </dd>
        </div>
      )}
    </dl>
  );

  const versionHistory = history.length > 1 && (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs text-muted-foreground">{t('common:template.detail.history')}</h2>
      <ol className="flex flex-col gap-1.5 text-sm">
        {history.map((entry) => (
          <li key={entry.version} className="flex gap-3">
            <span className="w-8 shrink-0 text-muted-foreground">v{entry.version}</span>
            <span className="w-24 shrink-0 text-muted-foreground">
              {dayjs(entry.publishedTime).format('YYYY-MM-DD')}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words">
              {entry.changelog ||
                t(
                  entry.version === 1
                    ? 'common:template.detail.firstRelease'
                    : 'common:template.detail.noChangelog'
                )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );

  if (isMobile) {
    return (
      <div className="absolute inset-0 flex size-full flex-col rounded bg-background">
        <div className="flex items-center gap-2 px-6 py-3 pe-9">
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
                  dir={contentDir}
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
              <Button className="flex-1 rounded-full" variant="outline" size="xs">
                <ArrowUpRight className="size-3" />
                {t('common:settings.templateAdmin.actions.preview')}
              </Button>
            </TemplatePreviewSheet>
            <Button
              className="flex-1 rounded-full"
              variant="outline"
              size="xs"
              onClick={handleCopyPermalink}
            >
              <Share2 className="size-3" />
              {t('common:template.non.share')}
            </Button>
            <Button
              className="flex-1 rounded-full"
              size="xs"
              onClick={install}
              disabled={isLoading}
            >
              {t('common:template.detail.install')}
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
          {sidebarExtra}
          {facts}
          {versionHistory}
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
      <div className="flex items-center gap-2 border-b px-6 py-3 pe-12">
        {onBackToTemplateList && (
          <Button className="h-auto p-0 font-normal" variant="link" onClick={onBackToTemplateList}>
            <ChevronLeft className="size-5" />
          </Button>
        )}
        <span className="text-sm text-muted-foreground">{t('common:template.title')}</span>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="truncate text-sm font-medium">{name}</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 bg-muted p-4">
          <TemplatePreview detail={templateDetail} isFull className="h-full" />
        </div>
        <aside
          ref={detailRef}
          className="flex w-[380px] shrink-0 flex-col gap-5 overflow-y-auto border-s px-6 py-5"
        >
          {cover?.presignedUrl && (
            <img
              src={cover.presignedUrl}
              alt={name}
              className="aspect-[16/9] w-full rounded-lg border object-cover"
            />
          )}
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">{name}</h1>
              {version !== undefined && (
                <Badge variant="secondary" className="px-1.5 text-xs font-normal">
                  v{version}
                </Badge>
              )}
              {categoryNames.map((categoryName) => (
                <Badge
                  variant="outline"
                  className={cn('px-1.5 text-xs font-normal text-muted-foreground')}
                  key={categoryName}
                >
                  {categoryName}
                </Badge>
              ))}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={install} disabled={isLoading}>
              {t('common:template.detail.install')}
              {isLoading && <Spin className="size-3" />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={t('common:template.non.share')}
              onClick={handleCopyPermalink}
            >
              <Share2 className="size-4" />
            </Button>
          </div>
          {sidebarExtra}
          {facts}
          {versionHistory}
          {markdownDescription && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs text-muted-foreground">{t('common:template.detail.about')}</h2>
              <MarkdownPreview className="p-0 text-sm">{markdownDescription}</MarkdownPreview>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
};
