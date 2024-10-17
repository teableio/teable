import enSDkJson from '@teable/common-i18n/src/locales/en/sdk.json';
import zhSDkJson from '@teable/common-i18n/src/locales/zh/sdk.json';
import type { Metadata } from 'next';
import { EnvProvider } from '../../components/EnvProvider';
import { I18nProvider } from '../../components/I18nProvider';
import QueryClientProvider from '../../components/QueryClientProvider';
import { PageType } from '../../components/types';
import enCommonJson from '../../locales/chart/en.json';
import zhCommonJson from '../../locales/chart/zh.json';
import type { IPageParams } from '../../types';
import { Pages } from './components/Pages';
import icon from './favicon.ico';

type Props = {
  searchParams: { lang: string };
};

const resources = {
  en: { sdk: enSDkJson, common: enCommonJson },
  zh: { sdk: zhSDkJson, common: zhCommonJson },
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  // read route params
  const lang = searchParams.lang;

  return {
    title: lang === 'zh' ? '图表' : 'Chart',
    icons: icon.src,
  };
}

export default async function Home(props: { searchParams: IPageParams }) {
  return (
    <main className="flex h-screen flex-col items-center justify-center">
      <EnvProvider>
        <I18nProvider
          lang={props.searchParams.lang}
          resources={resources}
          defaultNS="common"
          pageType={PageType.Chart}
        >
          <QueryClientProvider>
            <Pages {...props.searchParams} />
          </QueryClientProvider>
        </I18nProvider>
      </EnvProvider>
    </main>
  );
}
