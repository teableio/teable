import type { AuthorizedVo } from '@teable/openapi';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { OAuthLogo } from '../../oauth/OAuthLogo';
import { RevokeButton } from './RevokeButton';

export const List = (props: {
  list?: AuthorizedVo[];
  onDetail: (detail: AuthorizedVo) => void;
}) => {
  const { list, onDetail } = props;
  const { t } = useTranslation('common');
  const dayjs = useLanDayjs();

  return (
    <div className="flex-1 overflow-auto px-4">
      {list?.map((authorized) => (
        <div key={authorized.clientId} className="flex items-center gap-4 border-t py-4">
          <OAuthLogo logo={authorized.logo} name={authorized.name} className="size-14" />
          <div className="flex-1">
            <Button
              className="h-5 p-0 text-sm"
              variant={'link'}
              onClick={() => onDetail(authorized)}
            >
              {authorized.name}
            </Button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <p>
                {t('settings.integration.lastUsed', {
                  date: dayjs(authorized.lastUsedTime).fromNow(),
                })}
              </p>
              <p>
                {t('settings.integration.owner', {
                  user: authorized.createdUser.name,
                })}
              </p>
            </div>
          </div>
          <RevokeButton clientId={authorized.clientId} name={authorized.name} />
        </div>
      ))}
    </div>
  );
};
