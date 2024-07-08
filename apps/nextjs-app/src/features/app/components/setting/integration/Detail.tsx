import { Clock4, Home, User } from '@teable/icons';
import type { AuthorizedVo } from '@teable/openapi';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Button, Separator } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { OAuthLogo } from '../../oauth/OAuthLogo';
import { OAuthScope } from '../../oauth/OAuthScope';
import { RevokeButton } from './RevokeButton';

export const Detail = (props: { detail: AuthorizedVo; onBack: () => void }) => {
  const { detail, onBack } = props;
  const { logo, name, lastUsedTime, createdUser, homepage, description, scopes, clientId } = detail;
  const dayjs = useLanDayjs();
  const { t } = useTranslation('common');
  return (
    <div>
      <div className="flex items-center gap-4">
        <OAuthLogo logo={logo} name={name} />
        <div className="space-y-1">
          <p>{name}</p>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <p className="flex items-center gap-2">
              <Clock4 />
              {t('settings.integration.lastUsed', {
                date: dayjs(lastUsedTime).fromNow(),
              })}
            </p>
            <p className="flex items-center gap-2">
              <User />
              {t('settings.integration.owner', {
                user: createdUser.name,
              })}
            </p>
            <p className="flex items-center gap-2">
              <Home />
              <Button className="h-5 p-0" size="xs" variant={'link'}>
                <Link target="_blank" href={homepage}>
                  {homepage}
                </Link>
              </Button>
            </p>
          </div>
        </div>
      </div>
      <Separator className="my-4" />
      <div className="text-sm">{description}</div>
      <div className="mt-8 flex items-center justify-between">
        <div>{t('settings.integration.scopeTitle')}</div>
        <RevokeButton clientId={clientId} name={name} onSuccess={onBack} />
      </div>
      <Separator className="my-4" />
      <OAuthScope
        className="p-0"
        scopes={scopes}
        description={<div className="text-sm">{t('settings.integration.scopeDesc')}</div>}
      />
    </div>
  );
};
