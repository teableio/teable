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
