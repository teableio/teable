import { Label, Switch, Separator, Input } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useStorage } from '../hooks';
import { FormLabel } from './form/FormLabel';
import { ThemeSelect } from './form/ThemeSelect';

const PADDING_KEYS = ['top', 'right', 'bottom', 'left'] as const;

export const ChatAppearance = () => {
  const { t } = useTranslation('chart');
  const { storage, updateStorageByPath } = useStorage();
  const { appearance } = storage;
  const {
    theme,
    legendVisible,
    labelVisible,
    padding = { top: undefined, right: undefined, bottom: undefined, left: undefined },
  } = appearance;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2">
        <span>{t('chartV2.appearance.display')}</span>
        <ThemeSelect
          value={theme}
          onChange={(value) => {
            updateStorageByPath('appearance.theme', value);
          }}
        />
      </div>

      <div className="flex items-center space-x-2 py-2">
        <Label htmlFor="legend" className="w-full">
          {t('chartV2.appearance.legend')}
        </Label>
        <Switch
          id="legend"
          checked={legendVisible}
          onCheckedChange={(checked) => {
            updateStorageByPath('appearance.legendVisible', checked);
          }}
        />
      </div>

      <div className="flex items-center space-x-2 py-2">
        <Label htmlFor="label" className="w-full">
          {t('chartV2.appearance.label')}
        </Label>
        <Switch
          id="label"
          checked={labelVisible}
          onCheckedChange={(checked) => {
            updateStorageByPath('appearance.labelVisible', checked);
          }}
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <span className="text-md font-medium">{t('chartV2.appearance.style')}</span>
        <FormLabel label={t('chartV2.appearance.padding')}>
          <div className="grid grid-cols-2 gap-2 p-1">
            {PADDING_KEYS.map((key) => (
              <div className="flex items-center gap-2" key={key}>
                <div className="w-16 text-right text-xs">{t(`chartV2.appearance.${key}`)}</div>
                <Input
                  type="number"
                  defaultValue={padding?.[key]}
                  onBlur={(e) => {
                    updateStorageByPath(`appearance.padding.${key}`, e.target.value);
                  }}
                />
              </div>
            ))}
          </div>
        </FormLabel>
      </div>
    </div>
  );
};
