import { cn } from '@teable/ui-lib/shadcn';
import { TeableLogo } from '@/components/TeableLogo';
import { usePreviewUrl } from '../../hooks/usePreviewUrl';

export const OAuthLogo = (props: { logo?: string; name: string; className?: string }) => {
  const { logo, name, className } = props;

  const getPreviewUrl = usePreviewUrl();
  return (
    <div className={cn('relative size-16 overflow-hidden rounded-sm', className)}>
      {logo ? (
        <img
          src={getPreviewUrl(logo)}
          alt={name}
          className="absolute inset-0 size-full object-contain"
        />
      ) : (
        <TeableLogo className={cn('size-16', className)} />
      )}
    </div>
  );
};
