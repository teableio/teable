import { cn } from '@teable/ui-lib/shadcn';
import { Plug } from 'lucide-react';
import { TeableLogo } from '@/components/TeableLogo';
import { usePreviewUrl } from '../../hooks/usePreviewUrl';
import { getKnownClientIcon } from './known-client-icon';

export const OAuthLogo = (props: {
  logo?: string;
  name: string;
  className?: string;
  /** The client registered itself (MCP clients do); its logo is never shown. */
  dynamicRegistration?: boolean;
}) => {
  const { logo, name, className, dynamicRegistration } = props;

  const getPreviewUrl = usePreviewUrl();
  const knownIcon = dynamicRegistration ? getKnownClientIcon(name) : undefined;

  if (dynamicRegistration) {
    return (
      <div className={cn('relative size-16 overflow-hidden rounded-sm', className)}>
        {knownIcon ? (
          <>
            <img
              src={knownIcon.light}
              alt={name}
              className="absolute inset-0 size-full object-contain dark:hidden"
            />
            <img
              src={knownIcon.dark}
              alt={name}
              className="absolute inset-0 hidden size-full object-contain dark:block"
            />
          </>
        ) : (
          <div className="flex size-full items-center justify-center rounded-sm bg-muted text-muted-foreground">
            <Plug className="size-1/2" />
          </div>
        )}
      </div>
    );
  }

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
