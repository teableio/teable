import { Button, cn, Skeleton } from '@teable/ui-lib/shadcn';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

interface IFrameLoadingProps extends React.HTMLAttributes<HTMLIFrameElement> {
  src?: string;
  wrapperClassName?: string;
}

export const IFrameLoading = (props: IFrameLoadingProps) => {
  const { title, wrapperClassName, src, ...rest } = props;
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation(['table']);

  return (
    <div
      className={cn(
        'relative flex size-full flex-col overflow-hidden rounded-xl border shadow-sm',
        wrapperClassName
      )}
    >
      <div className="flex h-12 items-center justify-between border-b bg-gradient-to-r from-slate-50 to-slate-100/50 px-4 dark:from-slate-900 dark:to-slate-950">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="size-3 rounded-full bg-red-400"></div>
            <div className="size-3 rounded-full bg-yellow-400"></div>
            <div className="size-3 rounded-full bg-green-400"></div>
          </div>
          <span className="ml-3 font-mono text-sm text-muted-foreground">{src}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-muted-foreground px-2 py-1 text-xs text-muted">
            {t('table:aiChat.codeBlock.preview')}
          </div>
          <Button variant={'ghost'} size={'xs'} onClick={() => window.open(src, '_blank')}>
            <ExternalLink className="size-4" />
          </Button>
        </div>
      </div>
      {src && <iframe src={src} {...rest} title={title} onLoad={() => setLoading(false)} />}
      {loading && <Skeleton className="absolute inset-0 size-full bg-accent" />}
    </div>
  );
};
