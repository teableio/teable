import { useQuery } from '@tanstack/react-query';
import { listPluginPanels } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { usePluginPanelStore } from './usePluginPanelStore';

export const useActivePluginPanelId = (tableId: string) => {
  const { tables } = usePluginPanelStore();
  const { data: pluginPanels } = useQuery({
    queryKey: ReactQueryKeys.getPluginPanelList(tableId),
    queryFn: ({ queryKey }) => listPluginPanels(queryKey[1]).then((res) => res.data),
  });
  return tables[tableId]?.activePanel ?? pluginPanels?.[0]?.id;
};
