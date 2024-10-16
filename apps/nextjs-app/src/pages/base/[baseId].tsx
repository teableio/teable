import type { IGetBaseVo, ITableVo } from '@teable/openapi';
import type { GetServerSideProps } from 'next';
import { Trans, useTranslation } from 'next-i18next';
import type { ReactElement } from 'react';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Node: NextPageWithLayout = () => {
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);
  return (
    <div className="h-full flex-col md:flex">
      <div className="flex h-full flex-1 flex-col gap-2 lg:gap-4">
        <div className="items-center justify-between space-y-2 px-8 pb-2 pt-6 lg:flex">
          <h2 className="text-3xl font-bold tracking-tight">{t('table:welcome.title')}</h2>
        </div>
        <div className="flex h-full flex-col items-center justify-center p-4">
          <ul className="mb-4 space-y-2 text-left">
            <li>{t('table:welcome.description')}</li>
            <li>
              <Trans
                ns="table"
                i18nKey="welcome.help"
                components={{
                  HelpCenter: (
                    <a
                      href={t('help.mainLink')}
                      className="text-blue-500 hover:text-blue-700"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('table:welcome.helpCenter')}
                    </a>
                  ),
                }}
              ></Trans>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const { baseId } = context.query;
      const tables = await ssrApi.getTables(baseId as string);
      const defaultTable = tables[0];
      if (defaultTable) {
        const defaultView = await ssrApi.getDefaultViewId(baseId as string, defaultTable.id);
        return {
          redirect: {
            destination: `/base/${baseId}/${defaultTable.id}/${defaultView.id}`,
            permanent: false,
          },
        };
      }
      const base = await ssrApi.getBaseById(baseId as string);

      return {
        props: {
          tableServerData: tables,
          baseServerData: base,
          ...(await getTranslationsProps(context, ['common', 'sdk', 'table'])),
        },
      };
    })
  )
);

Node.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[]; baseServerData: IGetBaseVo }
) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default Node;
