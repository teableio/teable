import { usePluginPanelStorage } from './hooks/usePluginPanelStorage';
import { PluginPanelContainer } from './PluginPanelContainer';

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
