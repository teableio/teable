import { Code2, Key, Link } from '@teable/icons';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import type { ISidebarContentRoute } from '../components/sidebar/SidebarContent';

export const useSettingRoute = (): ISidebarContentRoute[] => {
  const { t } = useTranslation(['setting', 'common', 'developer']);
  const router = useRouter();
  const pathname = router.pathname;
  const isDeveloperToolQueryBuilder = pathname.includes('developer/tool/query-builder');
  return useMemo(() => {
    if (isDeveloperToolQueryBuilder) {
      return [
        {
          Icon: Code2,
          label: t('developer:apiQueryBuilder'),
          route: '/developer/tool/query-builder',
          pathTo: '/developer/tool/query-builder',
        },
      ];
    }

    return [
      {
        Icon: Key,
        label: t('setting:personalAccessToken'),
        route: '/setting/personal-access-token',
        pathTo: '/setting/personal-access-token',
      },
      {
        Icon: Link,
        label: (
          <>
            {t('setting:oauthApps')}
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
