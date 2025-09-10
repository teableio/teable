import Link from 'next/link';
import { Trans, useTranslation } from 'next-i18next';
import type { RefObject } from 'react';

interface IList {
  title: string;
  key: 'publicOrigin' | 'https' | 'databaseProxy' | 'llmApi' | 'v0' | 'email';
  anchor?: RefObject<HTMLDivElement>;
}

export interface IConfigurationListProps {
  list: IList[];
}

export const ConfigurationList = (props: IConfigurationListProps) => {
  const { list } = props;
  const { t } = useTranslation('common');
  return (
    <div>
      <div className="sticky top-0 flex h-auto w-[360px] min-w-[360px] flex-col space-y-4 rounded-lg border bg-secondary p-4">
        <div className="flex flex-col">
          <span className="justify-start self-stretch text-sm font-semibold text-foreground">
            {t('admin.configuration.title')}
          </span>
          <span className="justify-start self-stretch text-xs text-muted-foreground">
            {t('admin.configuration.description')}
          </span>
        </div>

        {list.map((item) => (
          <div key={item.title} className="flex flex-col">
            <span className="justify-start self-stretch text-sm font-medium text-foreground">
              {item.title}
            </span>
            <span className="justify-start self-stretch text-xs text-muted-foreground">
              <Trans
                ns="common"
                i18nKey={`admin.configuration.list.${item.key}.description`}
                components={{
                  anchor: (
                    <span
                      className="cursor-pointer text-blue-500"
                      onClick={() => item.anchor?.current?.scrollIntoView({ behavior: 'smooth' })}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          item.anchor?.current?.scrollIntoView({ behavior: 'smooth' });
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
