import { useBaseId } from '@teable/sdk/hooks';
import { BaseNodeContext } from './BaseNodeContext';
import { useBaseNode } from './hooks';

export const BaseNodeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const baseId = useBaseId() as string;
  const context = useBaseNode(baseId);
  return <BaseNodeContext.Provider value={context}>{children}</BaseNodeContext.Provider>;
};
