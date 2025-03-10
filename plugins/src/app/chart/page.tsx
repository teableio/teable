import enSDkJson from '@teable/common-i18n/src/locales/en/sdk.json';
import zhSDkJson from '@teable/common-i18n/src/locales/zh/sdk.json';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { EnvProvider } from '../../components/EnvProvider';
import { I18nProvider } from '../../components/I18nProvider';
import { PageType } from '../../components/types';
import enCommonJson from '../../locales/chart/en.json';
import zhCommonJson from '../../locales/chart/zh.json';
import type { IPageParams } from '../../types';
import { Hydrated } from './components/Hydrated';
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
  const cookieStore = await cookies();
  return (
    <main className="flex h-screen flex-col items-center justify-center">
      <EnvProvider>
        <I18nProvider
          lang={props.searchParams.lang}
          resources={resources}
          defaultNS="common"
          pageType={PageType.Chart}
        >
          <Hydrated searchParams={props.searchParams} cookie={cookieStore.toString()} />
        </I18nProvider>
      </EnvProvider>
    </main>
  );
}
