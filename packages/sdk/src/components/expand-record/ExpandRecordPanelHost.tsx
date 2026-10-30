import { cn } from '@teable/ui-lib';
import { type FC, type PropsWithChildren, useMemo, useState } from 'react';
import { ExpandRecordPanelHostContext } from './PanelContext';

/**
 * Marks a table node: records expanded anywhere inside it open as a side panel over the
 * node's right side instead of a centered dialog.
 */
export const ExpandRecordPanelHost: FC<PropsWithChildren<{ className?: string }>> = (props) => {
  const { className, children } = props;
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ inHost: true, container }), [container]);

  return (
    <div ref={setContainer} className={cn('relative', className)}>
      <ExpandRecordPanelHostContext.Provider value={value}>
        {children}
      </ExpandRecordPanelHostContext.Provider>
    </div>
  );
};
