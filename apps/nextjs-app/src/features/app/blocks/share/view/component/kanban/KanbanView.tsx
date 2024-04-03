/* eslint-disable @next/next/no-html-link-for-pages */
import { TeableNew } from '@teable/icons';
import { ActionTriggerProvider, RecordProvider } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated } from '@teable/sdk/hooks';
import { useContext } from 'react';
import { KanbanProvider } from '@/features/app/blocks/view/kanban/context';
import { KanbanViewBase } from '@/features/app/blocks/view/kanban/KanbanViewBase';
import { ShareViewPageContext } from '../../ShareViewPageContext';
import { GroupPointProvider } from '../grid/aggregation';
import { KanbanToolbar } from './toolbar';

export const KanbanView = () => {
  const { view } = useContext(ShareViewPageContext);
  const isHydrated = useIsHydrated();

  return (
    <div className="flex size-full flex-col md:px-3 md:pb-3">
      <div className="flex w-full justify-between px-1 py-2 md:px-0 md:py-3">
        <h1 className="font-semibold md:text-lg">{view?.name}</h1>
        <a href="/" className="flex items-center">
          <TeableNew className="text-black md:text-2xl" />
          <p className="ml-1 font-semibold">Teable</p>
        </a>
      </div>
      <div className="flex w-full grow flex-col overflow-hidden border md:rounded md:shadow-md">
        <SearchProvider>
          <ActionTriggerProvider>
            <RecordProvider>
              <GroupPointProvider>
                <KanbanToolbar />
                <KanbanProvider>
                  <div className="w-full grow overflow-hidden">
                    {isHydrated && <KanbanViewBase />}
                  </div>
                </KanbanProvider>
              </GroupPointProvider>
            </RecordProvider>
          </ActionTriggerProvider>
        </SearchProvider>
      </div>
    </div>
  );
};
