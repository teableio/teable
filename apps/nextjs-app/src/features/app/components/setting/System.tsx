import { useTheme } from '@teable/next-themes';
import { Label, RadioGroup, RadioGroupItem } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { LanguagePicker } from '../LanguagePicker';
import { InteractionSelect } from './InteractionSelect';
import { SettingTabHeader, SettingTabShell } from './SettingTabShell';

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

  return (
    <SettingTabShell header={<SettingTabHeader title={t('settings.setting.title')} />}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium text-foreground">{t('settings.setting.theme')}</h3>
            <p className="text-xs text-muted-foreground">{t('settings.setting.themeDesc')}</p>
          </div>
          <RadioGroup
            className="flex w-full justify-evenly"
            defaultValue={theme}
            onValueChange={(value) => {
              setTheme(value);
            }}
          >
            <div className="w-[206px]">
              <RadioGroupItem value="light" id="light" className="peer sr-only" />
              <Label
                htmlFor="light"
                className="flex cursor-pointer flex-col rounded-lg border-2 border-transparent bg-popover p-1 peer-data-[state=checked]:border-primary peer-data-[state=checked]:shadow-[0_4px_12px_rgba(0,0,0,0.08),0_2px_2px_rgba(0,0,0,0.06)] hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary"
              >
                <Image
                  className="overflow-hidden rounded-md border"
                  src={'/images/theme/theme-light.png'}
                  alt=""
                  width={198}
                  height={132}
                />
              </Label>
              <span className="mt-1 block w-full text-center text-sm font-normal">
                {t('settings.setting.light')}
              </span>
            </div>
            <div className="w-[206px]">
              <RadioGroupItem value="dark" id="dark" className="peer sr-only" />
              <Label
                htmlFor="dark"
                className="flex cursor-pointer flex-col rounded-lg border-2 border-transparent bg-popover p-1 peer-data-[state=checked]:border-primary peer-data-[state=checked]:shadow-[0_4px_12px_rgba(0,0,0,0.08),0_2px_2px_rgba(0,0,0,0.06)] hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary"
              >
                <Image
                  className="overflow-hidden rounded-md border"
                  src={'/images/theme/theme-dark.png'}
                  alt=""
                  width={198}
                  height={132}
                />
              </Label>
              <span className="mt-1 block w-full text-center text-sm font-normal">
                {t('settings.setting.dark')}
              </span>
            </div>
            <div className="w-[206px]">
              <RadioGroupItem value="system" id="system" className="peer sr-only" />
              <Label
                htmlFor="system"
                className="flex cursor-pointer flex-col rounded-lg border-2 border-transparent bg-popover p-1 peer-data-[state=checked]:border-primary peer-data-[state=checked]:shadow-[0_4px_12px_rgba(0,0,0,0.08),0_2px_2px_rgba(0,0,0,0.06)] hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary"
              >
                <Image
                  className="overflow-hidden rounded-md border"
                  src={'/images/theme/theme-system.png'}
                  alt=""
                  width={198}
                  height={132}
                />
              </Label>
              <span className="mt-1 block w-full text-center text-sm font-normal">
                {t('settings.setting.system')}
              </span>
            </div>
          </RadioGroup>
        </div>
        <div>
          <h3 className="text-sm font-medium text-foreground">{t('settings.setting.language')}</h3>
          <div className="pt-2">
            <LanguagePicker />
          </div>
        </div>
        {isSupportsMultiplePointers && (
          <div>
            <h3 className="text-sm font-medium text-foreground">
              {t('settings.setting.interactionMode')}
            </h3>
            <div className="pt-2">
              <InteractionSelect />
            </div>
          </div>
        )}
      </div>
    </SettingTabShell>
  );
};
