import { useIsReadOnlyPreview } from '@teable/sdk/hooks';
import { useEnv } from './useEnv';

export const useIsCommunity = () => {
  const { edition } = useEnv();
  const isReadOnlyPreview = useIsReadOnlyPreview();

  // In template/share preview mode, allow all features to be displayed
  // (similar to how template preview works)
  if (isReadOnlyPreview) {
    return false;
  }

  return edition?.toUpperCase() != 'EE' && edition?.toUpperCase() != 'CLOUD';
};
