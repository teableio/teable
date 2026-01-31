import { useQuery } from '@tanstack/react-query';
import { CellFormat, FieldKeyType, type IFilterSet, type ISortItem } from '@teable/core';
import { ArrowUpRight, Code2, MagicAi } from '@teable/icons';
import type { IQueryBaseRo } from '@teable/openapi';
import { getBaseAll, getTableList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { StandaloneViewProvider } from '@teable/sdk/context';
import {
  Button,
  ToggleGroup,
  ToggleGroupItem,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { Selector } from '@/components/Selector';
import { developerConfig } from '@/features/i18n/developer.config';
import { SettingRight } from '../SettingRight';
import { SettingRightTitle } from '../SettingRightTitle';
import { AIContextPanel } from './AIContextPanel';
import { FilterBuilder } from './FilterBuilder';
import { PreviewScript } from './PreviewScript';
import { PreviewTable } from './PreviewTable';
import { SearchBuilder } from './SearchBuilder';
import { OrderByBuilder } from './SortBuilder';
import { ViewBuilder } from './ViewBuilder';

export const QueryBuilder = () => {
  const { t } = useTranslation(developerConfig.i18nNamespaces);
  const searchParams = useSearchParams();
  const [baseId, setBaseId] = useState<string>(searchParams.get('baseId') ?? '');
  const [tableId, setTableId] = useState<string>(searchParams.get('tableId') ?? '');
  const [viewId, setViewId] = useState<string>();
  const [filter, setFilter] = useState<IFilterSet | null>(null);
  const [fieldKeyType, setFieldKeyType] = useState<FieldKeyType>();
  const [cellFormat, setCellFormat] = useState<CellFormat>();
  const [orderBy, setOrderBy] = useState<ISortItem[]>();
  const [search, setSearch] = useState<IQueryBaseRo['search']>();
  const { data: baseListReq } = useQuery({
    queryKey: ReactQueryKeys.baseAll(),
    queryFn: () => getBaseAll().then((data) => data.data),
  });

  const { data: tableListReq } = useQuery({
    queryKey: ReactQueryKeys.tableList(baseId as string),
    queryFn: () => getTableList(baseId as string).then((data) => data.data),
    enabled: Boolean(baseId),
  });

  const [activeTab, setActiveTab] = useState<string>('api-builder');

  const query = useMemo(
    () => ({
      fieldKeyType,
      viewId,
      filter,
      orderBy,
      search,
      cellFormat,
    }),
    [fieldKeyType, viewId, filter, orderBy, search, cellFormat]
  );

  return (
    <SettingRight
      header={
        <SettingRightTitle
          title={t('developer:apiQueryBuilder')}
          className="h-auto items-center gap-x-2"
          titleClassName="text-lg font-medium"
        />
      }
    >
      <StandaloneViewProvider baseId={baseId} tableId={tableId} viewId={viewId}>
        <div className="flex w-full flex-col gap-4 pb-8">
          {/* Data Source Selection */}
          <div className="text-sm">
            {t('developer:subTitle')}{' '}
            <Button variant="link" size="xs" asChild>
              <Link href={t('common:help.apiLink')} target="_blank">
                <ArrowUpRight className="size-4" />
                {t('developer:apiList')}
              </Link>
            </Button>
          </div>
          <p>{t('developer:chooseSource')}</p>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-2">
              <h1 className="text-sm font-medium">1. {t('common:noun.base')}</h1>
              <Selector
                className="w-80"
                placeholder={t('developer:action.selectBase')}
                candidates={baseListReq}
                selectedId={baseId}
                onChange={(id) => {
                  setBaseId(id);
                  setTableId('');
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="text-sm font-medium">2. {t('common:noun.table')}</h1>
              <Selector
                className="w-80"
                placeholder={t('developer:action.selectTable')}
                candidates={tableListReq}
                selectedId={tableId}
                onChange={(id) => setTableId(id)}
              />
            </div>
          </div>

          <hr className="my-4" />

          {/* Feature Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="api-builder" className="gap-2">
                <Code2 className="size-4" />
                {t('developer:tabs.apiBuilder')}
              </TabsTrigger>
              <TabsTrigger value="ai-context" className="gap-2">
                <MagicAi className="size-4" />
                {t('developer:tabs.aiContext')}
              </TabsTrigger>
            </TabsList>

            {/* API Builder Tab */}
            <TabsContent value="api-builder" className="space-y-6">
              {tableId ? (
                <>
                  <p className="text-sm text-muted-foreground">{t('developer:pickParams')}</p>
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <h2 className="text-sm font-medium">{t('common:noun.view')}</h2>
                      <ViewBuilder viewId={viewId} onChange={setViewId} />
                    </div>
                    <div className="flex flex-col gap-2">
                      <h2 className="text-sm font-medium">{t('common:actions.search')}</h2>
                      <SearchBuilder search={search} onChange={setSearch} />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <h2 className="text-sm font-medium">{t('sdk:filter.label')}</h2>
                    <FilterBuilder
                      filter={filter}
                      onChange={(f) => {
                        setFilter(f);
                      }}
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <h2 className="text-sm font-medium">{t('sdk:sort.label')}</h2>
                    <OrderByBuilder
                      orderBy={orderBy}
                      onChange={(o) => {
                        setOrderBy(o);
                      }}
                    />
                  </div>

                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <h2 className="text-sm font-medium">{t('developer:cellFormat')}</h2>
                      <ToggleGroup
                        className="w-auto justify-start"
                        variant="outline"
                        type="single"
                        size="sm"
                        value={cellFormat || CellFormat.Json}
                        onValueChange={(v) => setCellFormat((v as CellFormat) || CellFormat.Json)}
                      >
                        <ToggleGroupItem value="json" aria-label="Toggle json">
                          JSON
                        </ToggleGroupItem>
                        <ToggleGroupItem value="text" aria-label="Toggle text">
                          Text
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                    <div className="flex flex-col gap-2">
                      <h2 className="text-sm font-medium">{t('developer:fieldKeyType')}</h2>
                      <ToggleGroup
                        className="w-auto justify-start"
                        variant="outline"
                        type="single"
                        size="sm"
                        value={fieldKeyType || FieldKeyType.Name}
                        onValueChange={(v) => {
                          setFieldKeyType(v as FieldKeyType);
                        }}
                      >
                        <ToggleGroupItem value="name" aria-label="Toggle name">
                          name
                        </ToggleGroupItem>
                        <ToggleGroupItem value="id" aria-label="Toggle id">
                          id
                        </ToggleGroupItem>
                        <ToggleGroupItem value="dbFieldName" aria-label="Toggle dbFieldName">
                          dbFieldName
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                  </div>

                  <hr className="my-4" />

                  <div className="flex flex-col gap-4">
                    <h2 className="text-sm font-medium">{t('developer:buildResult')}</h2>
                    <PreviewScript tableId={tableId} query={query} />
                  </div>

                  <hr className="my-4" />

                  <div className="flex w-full flex-col gap-4">
                    <h2 className="text-sm font-medium">{t('developer:previewReturnValue')}</h2>
                    <PreviewTable query={query} />
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                  {t('developer:buildResultEmpty')}
                </div>
              )}
            </TabsContent>

            {/* AI Context Tab */}
            <TabsContent value="ai-context">
              <AIContextPanel tableId={tableId} baseId={baseId} />
            </TabsContent>
          </Tabs>
        </div>
      </StandaloneViewProvider>
    </SettingRight>
  );
};
