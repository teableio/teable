import { Key, Link } from '@teable/icons';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';

export const useSettingRoute = () => {
  const { t } = useTranslation(['setting', 'common']);

  return useMemo(() => {
    return [
      {
        Icon: Key,
        label: t('personalAccessToken'),
        route: '/setting/personal-access-token',
        pathTo: '/setting/personal-access-token',
      },
      {
        Icon: Link,
        label: (
          <>
            {t('oauthApps')}
            <span className="ml-1 h-5 rounded-sm border border-warning p-0.5 text-[11px] font-normal text-warning">
              {t('common:noun.beta')}
            </span>
          </>
        ),
        route: '/setting/oauth-app',
        pathTo: '/setting/oauth-app',
      },
      // {
      //   Icon: Code,
      //   label: t('setting:plugins'),
      //   route: '/setting/plugin',
      //   pathTo: '/setting/plugin',
      // },
    ];
  }, [t]);
};
