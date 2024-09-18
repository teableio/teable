import { EnvProvider } from '../components/EnvProvider';
import { I18nProvider } from '../components/I18nProvider';
import { Pages } from '../components/Pages';
import QueryClientProvider from '../components/QueryClientProvider';

export default async function Home(props: {
  searchParams: {
    lang: string;
    baseId: string;
    pluginInstallId: string;
    dashboardId: string;
    pluginId: string;
    theme: string;
  };
}) {
  return (
    <main className="flex h-screen flex-col items-center justify-center">
      <EnvProvider>
        <I18nProvider lang={props.searchParams.lang}>
          <QueryClientProvider>
            <Pages {...props.searchParams} />
          </QueryClientProvider>
        </I18nProvider>
      </EnvProvider>
    </main>
  );
}
