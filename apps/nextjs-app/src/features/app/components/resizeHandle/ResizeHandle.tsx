import { PanelResizeHandle } from 'react-resizable-panels';
import styles from './style.module.css';

export default function ResizeHandle({
  className = '',
  collapsed = false,
  id,
}: {
  className?: string;
  collapsed?: boolean;
  id?: string;
}) {
  return (
    <PanelResizeHandle className={[styles.ResizeHandleOuter, className].join(' ')} id={id}>
      <div className={styles.ResizeHandleInner} data-collapsed={collapsed || undefined}></div>
    </PanelResizeHandle>
  );
}
