import { useTheme } from '@teable/next-themes';
import { Label, RadioGroup, RadioGroupItem, Separator } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { LanguagePicker } from '../LanguagePicker';
import { InteractionSelect } from './InteractionSelect';

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
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">{t('settings.setting.title')}</h3>
      </div>
      <Separator />
      <div className="space-y-1">
        <div>
          <Label>{t('settings.setting.theme')}</Label>
          <div className="text-sm text-muted-foreground">{t('settings.setting.themeDesc')}</div>
        </div>
        <RadioGroup
          className="grid max-w-screen-md grid-cols-3 gap-4 pt-2 sm:gap-8"
          defaultValue={theme}
          onValueChange={(value) => {
            setTheme(value);
          }}
        >
          <div>
            <RadioGroupItem value="light" id="light" className="peer sr-only" />
            <Label
              htmlFor="light"
              className="flex flex-col rounded-md border-2 border-muted bg-popover peer-data-[state=checked]:border-primary hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary"
            >
              <div className="items-center rounded-md border-2 border-muted p-1 hover:border-accent">
                <div className="space-y-2 rounded-sm bg-[#ecedef] p-2">
                  <div className="space-y-2 rounded-md bg-white p-2 shadow-sm">
                    <div className="h-2 w-4/5 rounded-lg bg-[#ecedef] sm:w-[80px]" />
                    <div className="h-2 w-full rounded-lg bg-[#ecedef] sm:w-[100px]" />
                  </div>
                  <div className="flex items-center space-x-2 rounded-md bg-white p-2 shadow-sm">
                    <div className="size-4 rounded-full bg-[#ecedef]" />
                    <div className="h-2 w-[100px] rounded-lg bg-[#ecedef]" />
                  </div>
                  <div className="flex items-center space-x-2 rounded-md bg-white p-2 shadow-sm">
                    <div className="size-4 rounded-full bg-[#ecedef]" />
                    <div className="h-2 w-[100px] rounded-lg bg-[#ecedef]" />
                  </div>
                </div>
              </div>
            </Label>
            <span className="block w-full p-2 text-center font-normal">
              {t('settings.setting.light')}
            </span>
          </div>
          <div>
            <RadioGroupItem value="dark" id="dark" className="peer sr-only" />
            <Label
              htmlFor="dark"
              className="flex flex-col rounded-md border-2 border-muted bg-popover peer-data-[state=checked]:border-primary hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary"
            >
              <div className="items-center rounded-md border-2 border-muted bg-popover p-1 hover:bg-accent hover:text-accent-foreground">
                <div className="space-y-2 rounded-sm bg-slate-950 p-2">
                  <div className="space-y-2 rounded-md bg-slate-800 p-2 shadow-sm">
                    <div className="h-2 w-4/5 rounded-lg bg-slate-400 sm:w-[80px]" />
                    <div className="h-2 w-full rounded-lg bg-slate-400 sm:w-[100px]" />
                  </div>
                  <div className="flex items-center space-x-2 rounded-md bg-slate-800 p-2 shadow-sm">
                    <div className="size-4 rounded-full bg-slate-400" />
                    <div className="h-2 w-[100px] rounded-lg bg-slate-400" />
                  </div>
                  <div className="flex items-center space-x-2 rounded-md bg-slate-800 p-2 shadow-sm">
                    <div className="size-4 rounded-full bg-slate-400" />
                    <div className="h-2 w-[100px] rounded-lg bg-slate-400" />
                  </div>
                </div>
              </div>
            </Label>
            <span className="block w-full p-2 text-center font-normal">
              {t('settings.setting.dark')}
            </span>
          </div>
          <div>
            <RadioGroupItem value="system" id="system" className="peer sr-only" />
            <Label
              htmlFor="system"
              className="flex flex-col rounded-md border-2 border-muted bg-popover peer-data-[state=checked]:border-primary hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary"
            >
              <div className="items-center rounded-md border-2 border-muted p-1 hover:border-accent">
                <div className="space-y-2 rounded-sm bg-[#ecedef] p-2">
                  <div className="space-y-2 rounded-md bg-white p-2 shadow-sm">
                    <div className="h-2 w-4/5 rounded-lg bg-[#ecedef]" />
                    <div className="h-2 w-full rounded-lg bg-[#ecedef]" />
                    <div className="h-2 w-full rounded-lg bg-[#ecedef]" />
                  </div>
                  <div className="space-y-2 rounded-md bg-slate-800 p-2 shadow-sm">
                    <div className="h-2 w-4/5 rounded-lg bg-slate-400" />
                    <div className="h-2 w-full rounded-lg bg-slate-400" />
                    <div className="h-2 w-full rounded-lg bg-slate-400" />
                  </div>
                </div>
              </div>
            </Label>
            <span className="block w-full p-2 text-center font-normal">
              {t('settings.setting.system')}
            </span>
          </div>
        </RadioGroup>
      </div>
      <div>
        <Label>{t('settings.setting.language')}</Label>
        <div className="pt-2">
          <LanguagePicker />
        </div>
      </div>
      {isSupportsMultiplePointers && (
        <div>
          <Label>{t('settings.setting.interactionMode')}</Label>
          <div className="pt-2">
            <InteractionSelect />
          </div>
        </div>
      )}
      <div>
        <Label>{t('settings.setting.version')}</Label>
        <div className="pt-2 text-base">{process.env.NEXT_PUBLIC_BUILD_VERSION}</div>
      </div>
    </div>
  );
};
