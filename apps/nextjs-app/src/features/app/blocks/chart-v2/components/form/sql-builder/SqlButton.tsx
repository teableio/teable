import { useMutation } from '@tanstack/react-query';
import { Plus } from '@teable/icons';
import { getDashboardTestSqlResult } from '@teable/openapi';
import type { IBaseQueryVoV2, ITestSqlRo } from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  cn,
} from '@teable/ui-lib/shadcn';
import { get } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { useDashboardContext } from '@/features/app/dashboard/context';
import { useStorage } from '../../../hooks';
import { SqlBuilder } from './SqlBuilder';
import { SqlResult } from './SqlResult';

export const SqlButton = () => {
  const { t } = useTranslation('chart');
  const [activeTab, setActiveTab] = useState('ai');
  const hasModel = true;
  const { storage, updateStorageByPath } = useStorage();
  const sql = get(storage, 'query.sql') || '';
  const [editingSql, setEditingSql] = useState(sql);
  const baseId = useBaseId();
  const [testData, setTestData] = useState<IBaseQueryVoV2 | null>(null);

  const { chatComponent } = useDashboardContext();

  const { mutateAsync: getDashboardTestSqlResultFn } = useMutation({
    mutationFn: (testSqlRo: ITestSqlRo) =>
      getDashboardTestSqlResult(testSqlRo.baseId, testSqlRo.sql!).then((res) => res.data),
    onSuccess: (data) => {
      setActiveTab('result');
      setTestData(data || null);
    },
  });

  useEffect(() => {
    if (!hasModel) {
      setActiveTab('result');
    }
  }, [hasModel]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="size-4" />
          {t('chartV2.form.sql.title')}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[90vh] w-full max-w-[90vw] flex-col gap-0 p-0">
        <DialogHeader className="p-6">
          <DialogTitle>{t('chartV2.form.sql.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto overflow-x-hidden p-6 pt-0 sm:flex-row sm:overflow-hidden">
          <Card className="flex w-full flex-col shadow-none sm:w-5/12">
            <CardHeader className="h-12 justify-center border-b px-4 py-0">
              <CardTitle className="flex items-center justify-between text-base">
                <span>{t('chartV2.form.sql.sqlEditor')}</span>

                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    className="gap-1"
                    onClick={() => {
                      if (!baseId) return;
                      updateStorageByPath('query.sql', editingSql);
                    }}
                  >
                    {t('chartV2.form.sql.saveSql')}
                  </Button>

                  <Button
                    size="xs"
                    className="gap-1"
                    onClick={() => {
                      if (!baseId || !editingSql) return;
                      getDashboardTestSqlResultFn({ baseId, sql: editingSql });
                    }}
                  >
                    {t('chartV2.form.sql.runTest')}
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <SqlBuilder
                code={editingSql || ''}
                onChange={(value: string) => {
                  setEditingSql(value);
                }}
                style={{ borderRadius: '0 0 12px 12px' }}
              />
            </CardContent>
          </Card>

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex size-full flex-1 flex-col sm:w-1/4"
          >
            <TabsList
              className={cn(
                'grid h-10 w-full grid-cols-2 px-1.5 py-1',
                chatComponent ? 'grid-cols-2' : 'grid-cols-1'
              )}
            >
              {chatComponent && (
                <TabsTrigger className="h-7 w-full" value="ai">
                  {t('chartV2.form.sql.aiGenerate')}
                </TabsTrigger>
              )}
              <TabsTrigger className="h-7 w-full" value="result">
                {t('chartV2.form.sql.resultPreview')}
              </TabsTrigger>
            </TabsList>

            {chatComponent && (
              <TabsContent
                value="ai"
                className="mt-2 min-h-0 flex-1 data-[state=inactive]:hidden"
                forceMount
              >
                {chatComponent}
              </TabsContent>
            )}

            <TabsContent
              value="result"
              className="flex min-h-0 flex-1 bg-background data-[state=inactive]:hidden"
              forceMount
            >
              <Card className="flex w-full flex-col overflow-hidden bg-background shadow-none">
                <CardContent className="flex-1 overflow-auto bg-background p-0">
                  <SqlResult data={testData} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};
