import { BaseNodeContext } from './BaseNodeContext';
import { useBaseNode } from './hooks';

export const BaseNodeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const hooks = useBaseNode();
  return <BaseNodeContext.Provider value={hooks}>{children}</BaseNodeContext.Provider>;
};
