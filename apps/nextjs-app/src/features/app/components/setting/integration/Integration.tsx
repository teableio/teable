/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@teable/next-themes';
import type { AuthorizedVo } from '@teable/openapi';
import { getAuthorizedList } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { Detail } from './Detail';
import { List } from './List';

export const Integration = () => {
  const { t } = useTranslation('common');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [detail, setDetail] = useState<AuthorizedVo>();
  const { data: authorizedList } = useQuery({
    queryKey: ['integration'],
    queryFn: () => getAuthorizedList().then((res) => res.data),
  });

  return (
    <div className="flex h-full flex-col gap-6 border-l px-8 py-4">
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
      {!detail && (
        <div className="flex size-full flex-col items-center justify-center gap-4 text-center text-sm text-muted-foreground">
          <Image
            src={
              isDark
                ? '/images/layout/empty-integration-dark.png'
                : '/images/layout/empty-integration-light.png'
            }
            alt="No roles available"
            width={160}
            height={160}
          />
          <p>{t('settings.integration.description', { count: authorizedList?.length })}</p>
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
