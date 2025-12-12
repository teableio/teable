import { Slack } from '@teable/icons';
import { UserIntegrationProvider } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';

const PROVIDER_ICONS: Record<UserIntegrationProvider, React.ReactNode> = {
  [UserIntegrationProvider.Slack]: <Slack className="size-8" />,
};

export const UserIntegrationProviderLogo = (props: {
  provider: UserIntegrationProvider;
  className?: string;
}) => {
  const { provider, className } = props;

  return (
    <div className={cn('flex items-center justify-center', className)}>
      {PROVIDER_ICONS[provider]}
    </div>
  );
};
