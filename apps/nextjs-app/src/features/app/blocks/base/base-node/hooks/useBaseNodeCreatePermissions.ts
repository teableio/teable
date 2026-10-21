import { useBasePermission } from '@teable/sdk/hooks';
import { useDisableAIAction } from '@/features/app/hooks/useDisableAIAction';
import { useIsCommunity } from '@/features/app/hooks/useIsCommunity';
import { useSetting } from '@/features/app/hooks/useSetting';

/** Which kinds of node the viewer may create in the base. */
export const useBaseNodeCreatePermissions = () => {
  const permission = useBasePermission();
  const { aiChat: aiChatEnabled } = useDisableAIAction();
  const { disallowDashboard } = useSetting();
  const isCommunity = useIsCommunity();
  return {
    canCreateTable: Boolean(permission?.['table|create']),
    canCreateDashboard: Boolean(permission?.['base|update'] && !disallowDashboard),
    canCreateWorkflow: !isCommunity && Boolean(permission?.['automation|create']),
    canCreateRoutine: !isCommunity && Boolean(permission?.['routine|create']),
    canCreateApp: !isCommunity && Boolean(aiChatEnabled && permission?.['app|create']),
    canCreateFolder: Boolean(permission?.['base|update']),
  };
};
