import { Tabs, TabsContent, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { ChatAppearance } from './ChatAppearance';
import { DataConfig } from './DataConfig';

export const ChartConfig = () => {
  const { t } = useTranslation('chart');

  return (
    <div className="w-[360px] shrink-0 px-6 pb-4 pt-2">
      <Tabs defaultValue="dataConfig" className="flex size-full flex-col overflow-hidden">
        <TabsList className="w-full">
          <TabsTrigger value="dataConfig" className="w-full">
            {t('chartV2.dataConfig')}
          </TabsTrigger>
          <TabsTrigger value="appearance" className="w-full">
            {t('chartV2.chartAppearance')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dataConfig" className="flex-1 overflow-auto">
          <DataConfig />
        </TabsContent>
        <TabsContent value="appearance" className="flex-1 overflow-auto">
          <ChatAppearance />
        </TabsContent>
      </Tabs>
    </div>
  );
};
