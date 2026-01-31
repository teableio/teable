import type { ITemplateVo } from '@teable/openapi';
import { useIsHydrated } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { useMeasure } from 'react-use';

export const TemplatePreview = (props: {
  detail?: ITemplateVo;
  hidePreviewButton?: boolean;
  className?: string;
  isFull?: boolean;
}) => {
  const { detail, hidePreviewButton, className, isFull } = props;
  const { snapshot, name, id } = detail || {};
  const [isLoading, setIsLoading] = useState(true);
  const { t } = useTranslation(['common']);
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const isHydrated = useIsHydrated();
  // Use permalink for template preview
  const url = id
    ? `${window.location.origin}/t/${id}`
    : snapshot?.baseId
      ? `${window.location.origin}/base/${snapshot.baseId}`
      : '';
  useEffect(() => {
    if (url) {
      setIsLoading(true);
    }
  }, [url]);

  if (!isHydrated) {
    return (
      <div className="absolute inset-0 flex items-center justify-center rounded-lg border bg-background text-sm text-muted-foreground">
        <Spin className="size-4" />
      </div>
    );
  }

  const height = width * (640 / 1240);

  return (
    <div className={cn('relative', className)} ref={isFull ? null : ref}>
      <div style={{ height: isFull ? '100%' : `${height}px` }}></div>
      {url && (
        <iframe
          className="absolute inset-0 overflow-hidden rounded-lg border"
          src={url}
          title={name}
          width={isFull ? '100%' : width}
          height={isFull ? '100%' : height}
          onLoad={() => requestAnimationFrame(() => setIsLoading(false))}
        />
      )}
      {(isLoading || !url) && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded-lg border bg-background text-sm text-muted-foreground"
          style={{ height: isFull ? '100%' : `${height}px` }}
        >
          {t('common:actions.loading')}
        </div>
      )}
      {!hidePreviewButton && (
        <div className="absolute bottom-3 right-3">
          <Button variant="outline" size="xs" onClick={() => window.open(url, '_blank')}>
            <ArrowUpRight className="size-4" />
            {t('common:settings.templateAdmin.actions.preview')}
          </Button>
        </div>
      )}
    </div>
  );
};
