import { GroupPointProvider, RecordProvider, ShareViewContext } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useContext } from 'react';
import { KanbanProvider } from '@/features/app/blocks/view/kanban/context';
import { KanbanViewBase } from '@/features/app/blocks/view/kanban/KanbanViewBase';
import { EmbedFooter } from '../../EmbedFooter';
import { ShareViewHeader } from '../../ShareSignInButton';
import { KanbanToolbar } from './toolbar';

export const KanbanView = () => {
  const { view } = useContext(ShareViewContext);
  const isHydrated = useIsHydrated();
  const {
    query: { hideToolBar, embed },
  } = useRouter();

  return (
    <div className={cn('flex size-full flex-col', embed ? '' : 'md:px-3 md:pb-3')}>
      {!embed && <ShareViewHeader viewName={view?.name} />}
      <div className="flex w-full grow flex-col overflow-hidden border md:rounded md:shadow-md">
        <SearchProvider>
          <RecordProvider>
            <GroupPointProvider>
              {!hideToolBar && <KanbanToolbar />}
              <KanbanProvider>
                <div className="w-full grow overflow-hidden">
                  {isHydrated && <KanbanViewBase />}
                </div>
              </KanbanProvider>
              {embed && <EmbedFooter />}
            </GroupPointProvider>
          </RecordProvider>
        </SearchProvider>
      </div>
    </div>
  );
};
