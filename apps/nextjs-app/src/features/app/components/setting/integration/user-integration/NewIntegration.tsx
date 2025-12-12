import { UserIntegrationProvider } from '@teable/openapi';
import { Popover, PopoverContent, PopoverTrigger, Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { UserIntegrationProviderLogo } from '../../../user-integration/ProviderLogo';
import { getUserIntegrationName, openConnectIntegration } from '../../../user-integration/utils';

export const NewIntegration = (props: { children: React.ReactNode }) => {
  const { children } = props;
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('common');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>{children}</PopoverTrigger>
      <PopoverContent className="h-auto w-64 p-2 text-[0px]">
        {Object.values(UserIntegrationProvider).map((provider) => (
          <Button
            key={provider as string}
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 px-2 text-sm font-normal"
            onClick={() => {
              openConnectIntegration(provider, {
                name: t('settings.integration.userIntegration.defaultName', {
                  name: getUserIntegrationName(provider),
                }),
              });
              setOpen(false);
            }}
          >
            <UserIntegrationProviderLogo provider={provider} className="size-5" />
            <span>{getUserIntegrationName(provider)}</span>
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
};
