import { Tabs, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { SettingTabGroupProvider } from '../SettingTabShell';

export interface IDeveloperToolTab {
  key: string;
  name: string;
  content: ReactNode;
}

interface IDeveloperToolsSectionProps {
  tabs: IDeveloperToolTab[];
  /** The dialog's tab: when it is one of `tabs` that one shows, otherwise the first. */
  tab: string;
  onTabChange: (tab: string) => void;
}

/** Tokens, OAuth apps and the AI tool guides: everything that lets other tools reach Teable. */
export const DeveloperToolsSection = ({ tabs, tab, onTabChange }: IDeveloperToolsSectionProps) => {
  const { t } = useTranslation('common');
  const active = tabs.find((item) => item.key === tab) ?? tabs[0];

  const group = useMemo(
    () => ({
      title: t('settings.developerTools.title'),
      tabs: (
        <Tabs value={active?.key} onValueChange={onTabChange}>
          <TabsList className="max-w-full justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((item) => (
              <TabsTrigger key={item.key} value={item.key}>
                {item.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ),
    }),
    [active?.key, onTabChange, t, tabs]
  );

  return <SettingTabGroupProvider value={group}>{active?.content}</SettingTabGroupProvider>;
};
