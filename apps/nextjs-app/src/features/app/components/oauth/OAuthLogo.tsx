import { TeableNew } from '@teable/icons';
import { cn } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { usePreviewUrl } from '../../hooks/usePreviewUrl';

export const OAuthLogo = (props: { logo?: string; name: string; className?: string }) => {
  const { logo, name, className } = props;

  const getPreviewUrl = usePreviewUrl();
  return (
    <div className={cn('relative size-16 overflow-hidden rounded-sm', className)}>
      {logo ? (
        <Image
          src={getPreviewUrl(logo)}
          alt={name}
          fill
          sizes="100%"
          style={{
            objectFit: 'contain',
          }}
        />
      ) : (
        <TeableNew className={cn('size-16 text-black', className)} />
      )}
    </div>
  );
};
