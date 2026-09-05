/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { Plus } from '@teable/icons';
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { SettingTabShell } from '../SettingTabShell';
import { ThirdPartyIntegrationsContent } from './third-party-integrations/Content';
import { UserIntegrationContent } from './user-integration/Content';
import { NewIntegration } from './user-integration/NewIntegration';

export const Integration = () => {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<'user' | 'third-party'>('user');

  return (
    <SettingTabShell
      className="relative"
      title={t('settings.integration.title')}
      actions={
        <NewIntegration>
          <Button
            variant="outline"
            size="sm"
            className="justify-start gap-2 text-sm font-normal text-foreground"
          >
            <Plus className="size-4" />
            {t('settings.integration.userIntegration.create')}
          </Button>
        </NewIntegration>
      }
    >
      <Tabs
        className="flex h-full flex-1 flex-col gap-4 overflow-hidden"
        value={tab}
        onValueChange={(value) => setTab(value as 'user' | 'third-party')}
      >
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="user" className="min-w-0 flex-1 px-2 sm:flex-none sm:px-3">
            <span className="truncate">{t('settings.integration.userIntegration.title')}</span>
          </TabsTrigger>
          <TabsTrigger value="third-party" className="min-w-0 flex-1 px-2 sm:flex-none sm:px-3">
            <span className="truncate">
              {t('settings.integration.thirdPartyIntegrations.title')}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent className="mt-0 flex-1 overflow-hidden" value="user">
          <UserIntegrationContent />
        </TabsContent>
        <TabsContent className="mt-0 flex-1 overflow-hidden" value="third-party">
          <ThirdPartyIntegrationsContent />
        </TabsContent>
      </Tabs>
    </SettingTabShell>
  );
};
