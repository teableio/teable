import { cn } from '@teable/ui-lib';
import { type FC, type PropsWithChildren, useCallback, useMemo, useState } from 'react';
import { ExpandRecordPanelHostContext } from './PanelContext';

/**
 * Marks a table node: records expanded anywhere inside it open as a side panel over the
 * node's right side instead of a centered dialog.
 */
export const ExpandRecordPanelHost: FC<PropsWithChildren<{ className?: string }>> = (props) => {
  const { className, children } = props;
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [roots, setRoots] = useState<string[]>([]);
  const registerRoot = useCallback((id: string) => {
    setRoots((open) => [...open, id]);
    return () => setRoots((open) => open.filter((openId) => openId !== id));
  }, []);
  const raiseRoot = useCallback((id: string) => {
    setRoots((open) =>
      open.includes(id) && open.at(-1) !== id
        ? [...open.filter((openId) => openId !== id), id]
        : open
    );
  }, []);
  const value = useMemo(
    () => ({ inHost: true, container, roots, registerRoot, raiseRoot }),
    [container, roots, registerRoot, raiseRoot]
  );

  return (
    <div ref={setContainer} className={cn('relative', className)}>
      <ExpandRecordPanelHostContext.Provider value={value}>
        {children}
      </ExpandRecordPanelHostContext.Provider>
    </div>
  );
};
