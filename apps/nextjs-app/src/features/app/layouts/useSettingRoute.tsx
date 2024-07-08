import { Key, Link } from '@teable/icons';
import { Badge } from '@teable/ui-lib/shadcn';
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
            <Badge
              variant={'outline'}
              className="ml-1 h-5 -translate-y-1 p-0.5 text-[11px] font-normal"
            >
              {t('common:noun.beta')}
            </Badge>
          </>
        ),
        route: '/setting/oauth-app',
        pathTo: '/setting/oauth-app',
      },
    ];
  }, [t]);
};
