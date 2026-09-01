import { useContext, useMemo } from 'react';
import { AppContext } from '../context/app/AppContext';
import { useTablePermission } from './use-table-permission';

/**
 * Reading comments follows `record|read`: whoever can see the record can see its
 * discussion, and only writing is gated by `record|comment` — a Viewer gets the
 * panel with a disabled composer, not a hidden panel.
 *
 * Share links are the exception on both counts — a shared view and a shared base
 * alike: comments would leak internal collaborator identities to external
 * visitors, and the comment endpoints reject the share-view header outright.
 * AppContext.shareId is set by both share layouts, so it is the one flag that
 * covers every share surface.
 */
export const useCommentPermission = () => {
  const permission = useTablePermission();
  const { shareId } = useContext(AppContext);

  return useMemo(() => {
    // writing is never wider than reading: a comment hangs off a record you can see
    const commentReadable = !shareId && Boolean(permission['record|read']);
    return {
      commentReadable,
      commentWritable: commentReadable && Boolean(permission['record|comment']),
    };
  }, [permission, shareId]);
};
