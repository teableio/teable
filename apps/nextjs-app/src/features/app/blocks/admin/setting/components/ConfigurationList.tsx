import Link from 'next/link';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
import type { RefObject } from 'react';
import { scrollToTarget } from '../utils';

export interface IList {
  title: string;
  key: 'publicOrigin' | 'https' | 'databaseProxy' | 'llmApi' | 'app' | 'webSearch' | 'email';
  anchor?: RefObject<HTMLDivElement>;
  values?: Record<string, string>;
  path: string;
}

export interface IConfigurationListProps {
  list: IList[];
}

export const ConfigurationList = (props: IConfigurationListProps) => {
  const { list } = props;
  const { t } = useTranslation('common');

  const router = useRouter();

  return (
    <div>
      <div className="sticky top-0 mt-4 flex h-44 w-full min-w-full flex-col space-y-4 overflow-y-auto rounded-lg border bg-secondary p-4 sm:h-auto sm:w-[360px] sm:min-w-[360px] sm:overflow-hidden">
        <div className="flex flex-col">
          <span className="mb-1 justify-start self-stretch text-base font-semibold text-foreground">
            {t('admin.configuration.title')}
          </span>
          <span className="justify-start self-stretch text-xs text-muted-foreground">
            {t('admin.configuration.description')}
          </span>
        </div>

        {list.map((item) => (
          <div key={item.title} className="flex flex-col">
            <span className="mb-1 justify-start self-stretch text-sm font-medium text-foreground">
              {item.title}
            </span>
            <span className="justify-start self-stretch text-xs text-muted-foreground">
              <Trans
                ns="common"
                i18nKey={`admin.configuration.list.${item.key}.description`}
                values={item.values ?? undefined}
                components={{
                  anchor: (
                    <span
                      className="cursor-pointer text-blue-500"
                      onClick={() => {
                        const { path } = item;
                        if (path && !path.includes(router.pathname)) {
                          router.push(path);
                        }
                        item.anchor?.current && scrollToTarget(item.anchor.current);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          const { path } = item;
                          if (path && !path.includes(router.pathname)) {
                            router.push(path);
                          }
                          item.anchor?.current && scrollToTarget(item.anchor.current);
                        }
                      }}
                    />
                  ),
                  strong: <span className="font-bold" />,
                  underline: <span className="underline" />,
                  a: (
                    <Link
                      className="cursor-pointer text-blue-500"
                      href={t(`admin.configuration.list.${item.key as 'databaseProxy'}.href`)}
                      target="_blank"
                      rel="noreferrer"
                    />
                  ),
                }}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
