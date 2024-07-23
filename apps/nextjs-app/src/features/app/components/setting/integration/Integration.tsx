/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import { useQuery } from '@tanstack/react-query';
import type { AuthorizedVo } from '@teable/openapi';
import { getAuthorizedList } from '@teable/openapi';
import { cn, Separator } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { Detail } from './Detail';
import { List } from './List';

export const Integration = () => {
  const { t } = useTranslation('common');
  const [detail, setDetail] = useState<AuthorizedVo>();
  const { data: authorizedList } = useQuery({
    queryKey: ['integration'],
    queryFn: () => getAuthorizedList().then((res) => res.data),
  });

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="flex items-center text-lg font-medium">
        <h3
          className={cn('text-lg font-medium', {
            'hover:underline hover:text-foreground cursor-pointer text-muted-foreground': detail,
          })}
          onClick={() => setDetail(undefined)}
        >
          {t('settings.integration.title')}
        </h3>
        {detail && <div className="px-2">/</div>}
        {detail && <div>{detail?.name}</div>}
      </div>
      <Separator />
      {!detail && (
        <div className="text-sm text-muted-foreground">
          {t('settings.integration.description', { count: authorizedList?.length })}
        </div>
      )}
      <div className="flex-1 overflow-auto px-4">
        {detail ? (
          <Detail detail={detail} onBack={() => setDetail(undefined)} />
        ) : (
          <List list={authorizedList} onDetail={setDetail} />
        )}
      </div>
    </div>
  );
};
