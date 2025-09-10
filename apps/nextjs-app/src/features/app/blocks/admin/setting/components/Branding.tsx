import { Label, sonner } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { settingPluginConfig } from '@/features/i18n/setting-plugin.config';
import { BrandingLogo } from './BrandingLogo';

export const Branding = ({
  brandName,
  brandLogo,
  onChange,
}: {
  brandName?: string | null;
  brandLogo?: string | null;
  onChange: (brandName: string) => void;
}) => {
  const { t } = useTranslation(settingPluginConfig.i18nNamespaces);
  const [name, setName] = useState(brandName || '');

  return (
    <div className="pb-6">
      <h2 className="mb-4 text-lg font-medium">{t('admin.setting.brandingSettings.title')}</h2>
      <div className="flex w-full flex-col space-y-4">
        <div className="space-y-2 rounded-lg border p-4 shadow-sm">
          <p className="text-xs text-gray-500">{t('admin.setting.brandingSettings.description')}</p>
          <div className="flex items-center justify-between">
            <Label htmlFor="brand-name">{t('admin.setting.brandingSettings.brandName')}</Label>
            <input
              id="brand-name"
              type="text"
              className="rounded-md border px-3 py-2"
              placeholder="Teable"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              onBlur={() => {
                onChange(name);
                sonner.toast(t('common:actions.saveSucceed'));
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="brand-logo">{t('admin.setting.brandingSettings.logo')}</Label>
            <BrandingLogo value={brandLogo || undefined} />
          </div>
        </div>
      </div>
    </div>
  );
};
