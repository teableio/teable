import { Moon, Sun } from '@teable/icons';
import { useTheme } from '@teable/ui-lib';
import { Tabs, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn';
import { Contrast } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { LanguagePicker } from '../LanguagePicker';
import { InteractionSelect } from './InteractionSelect';
import { Notifications } from './Notifications';
import { SettingGroup, SettingRow } from './SettingGroup';
import { SettingTabShell } from './SettingTabShell';

// One width for every select on the page, so they line up down the right edge
const SELECT_CLASS_NAME = 'w-full sm:w-48';

export const System: React.FC = () => {
  const { t } = useTranslation('common');
  const { theme, setTheme } = useTheme();

  const isSupportsMultiplePointers = useMemo(() => {
    const touchSupported: boolean =
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).msMaxTouchPoints > 0;
    const mouseSupported: boolean =
      window.matchMedia('(pointer: fine)').matches || window.matchMedia('(hover: hover)').matches;
    return touchSupported && mouseSupported;
  }, []);

  const themes = [
    { value: 'light', label: t('settings.setting.light'), Icon: Sun },
    { value: 'dark', label: t('settings.setting.dark'), Icon: Moon },
    { value: 'system', label: t('settings.setting.system'), Icon: Contrast },
  ];

  return (
    <SettingTabShell title={t('settings.setting.title')}>
      <div className="flex max-w-3xl flex-col gap-8">
        <SettingGroup title={t('settings.setting.interfaceTitle')}>
          <SettingRow
            label={t('settings.setting.theme')}
            action={
              // Manual activation: a tab only switches on click or Enter. Selecting on focus would
              // switch again right after the click, and arrowing across would repaint each theme
              <Tabs
                size="sm"
                activationMode="manual"
                value={theme ?? 'system'}
                onValueChange={setTheme}
              >
                <TabsList>
                  {themes.map(({ value, label, Icon }) => (
                    <TabsTrigger key={value} value={value} className="gap-1.5">
                      <Icon className="size-3.5 shrink-0" />
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            }
          />
          <SettingRow
            label={t('settings.setting.language')}
            action={<LanguagePicker className={SELECT_CLASS_NAME} />}
          />
          {isSupportsMultiplePointers && (
            <SettingRow
              label={t('settings.setting.interactionMode')}
              action={<InteractionSelect className={SELECT_CLASS_NAME} />}
            />
          )}
        </SettingGroup>
        <Notifications />
      </div>
    </SettingTabShell>
  );
};
