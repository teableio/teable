import { isAnonymous } from '@teable/core';
import type { IGroupPointsVo } from '@teable/openapi';
import type { GridView } from '@teable/sdk';
import { useGridColumns } from '@teable/sdk';
import { ShareViewContext } from '@teable/sdk/context';
import { useIsHydrated, useSession, useUndoRedo, useView, useViewId } from '@teable/sdk/hooks';
import { Skeleton } from '@teable/ui-lib';
import React, { useContext } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { GridViewBaseInner } from '@/features/app/blocks/view/grid/GridViewBaseInner';

interface IGridViewProps {
  groupPointsServerData?: IGroupPointsVo | null;
}

// Reuses the workspace grid renderer end-to-end. ShareContext (provided in
// ShareViewPage) toggles share-aware branches inside GridViewBaseInner; the
// share-edit permission set (record|create/update/delete via header sandbox)
// surfaces the right UI affordances. Workspace-only features (field config,
// view config, comments, history) stay hidden because the share permission
// provider keeps those actions false.
//
// We deliberately omit onRowExpand so GridViewBaseInner's default
// router-based expand flow (and its built-in ExpandRecordContainer render)
// fires — passing our own callback would suppress that internal render.
export const GridViewBase: React.FC<IGridViewProps> = ({ groupPointsServerData }) => {
  const activeViewId = useViewId();
  const view = useView(activeViewId) as GridView | undefined;
  const { columns } = useGridColumns();
  const isLoading = !view || !columns.length;
  const isHydrated = useIsHydrated();

  // Workspace Table.tsx wires Cmd+Z / Cmd+Shift+Z hotkeys, but share view
  // never mounts Table.tsx — wire them here so share editors get the same
  // undo/redo affordance. Gated on (allowEdit + signed-in) so anonymous
  // viewers and read-only links don't burn requests against an empty stack
  // every time someone reflexively hits Cmd+Z.
  const { shareMeta } = useContext(ShareViewContext);
  const { user } = useSession();
  const canEdit = Boolean(shareMeta?.allowEdit) && !isAnonymous(user?.id);
  const { undo, redo } = useUndoRedo();
  useHotkeys('mod+z', () => undo(), { preventDefault: true, enabled: canEdit });
  useHotkeys(['mod+shift+z', 'mod+y'], () => redo(), { preventDefault: true, enabled: canEdit });

  if (!isHydrated || isLoading) {
    return (
      <div className="relative size-full overflow-hidden">
        <div className="flex w-full items-center space-x-4">
          <div className="w-full space-y-3 px-2">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return <GridViewBaseInner groupPointsServerData={groupPointsServerData} />;
};
