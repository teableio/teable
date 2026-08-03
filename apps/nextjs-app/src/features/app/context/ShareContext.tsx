import { useIsAnonymous } from '@teable/sdk';
import { createContext, useContext } from 'react';

interface IShareContext {
  shareId?: string;
  // URL prefix like `/share/{shareId}` to prepend to base URLs
  urlPrefix?: string;
  // Allowed node ID for base share filtering (the shared node and its descendants)
  nodeId?: string;
  // Whether users can copy/save the shared base to their space
  allowSave?: boolean;
  // Whether users can copy data from the shared base
  allowCopy?: boolean;
  // Whether logged-in users can edit records
  allowEdit?: boolean;
}

export const ShareContext = createContext<IShareContext>({});

export const useShareContext = () => useContext(ShareContext);

export const useShareUrlPrefix = () => {
  const { urlPrefix } = useShareContext();
  return urlPrefix || '';
};

export const useShareNodeId = () => {
  const { nodeId } = useShareContext();
  return nodeId;
};

export const useShareAllowSave = () => {
  const { allowSave } = useShareContext();
  return allowSave ?? false;
};

export const useShareAllowCopy = () => {
  const { allowCopy } = useShareContext();
  return allowCopy ?? false;
};

export const useShareAllowEdit = () => {
  const { allowEdit } = useShareContext();
  return allowEdit ?? false;
};

/**
 * Whether the current user effectively has edit permissions on this share link.
 * Returns true only when allowEdit is enabled AND the user is logged in —
 * anonymous users on an allowEdit link are treated as read-only.
 */
export const useShareEffectiveEdit = () => {
  const { shareId } = useShareContext();
  const allowEdit = useShareAllowEdit();
  const isAnonymous = useIsAnonymous();
  return Boolean(shareId && allowEdit && !isAnonymous);
};
