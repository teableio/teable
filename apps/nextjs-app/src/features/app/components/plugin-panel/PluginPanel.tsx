import dynamic from 'next/dynamic';
import { usePluginPanelStorage } from './hooks/usePluginPanelStorage';

// The panel's layout grid loads when the panel is shown.
const PluginPanelContainer = dynamic(
  () => import('./PluginPanelContainer').then((mod) => mod.PluginPanelContainer),
  { ssr: false }
);

interface IPluginPanelProps {
  tableId: string;
}
export const PluginPanel = (props: IPluginPanelProps) => {
  const { tableId } = props;
  const { isVisible } = usePluginPanelStorage(tableId);
  if (!isVisible) {
    return <></>;
  }

  return <PluginPanelContainer tableId={tableId} />;
};
