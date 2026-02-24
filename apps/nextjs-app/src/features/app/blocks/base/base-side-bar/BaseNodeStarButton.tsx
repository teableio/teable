import { BaseNodeResourceType, PinType } from '@teable/openapi';
import { useIsAnonymous, useIsReadOnlyPreview } from '@teable/sdk/hooks';
import { useMemo } from 'react';
import { StarButton } from '../../space/space-side-bar/StarButton';

interface IBaseNodeStarButtonProps {
  resourceType: BaseNodeResourceType;
  resourceId: string;
}

export const BaseNodeStarButton = (props: IBaseNodeStarButtonProps) => {
  const { resourceType, resourceId } = props;
  const isAnonymous = useIsAnonymous();
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const pinType = useMemo(() => {
    switch (resourceType) {
      case BaseNodeResourceType.Table:
        return PinType.Table;
      case BaseNodeResourceType.Dashboard:
        return PinType.Dashboard;
      case BaseNodeResourceType.Workflow:
        return PinType.Workflow;
      case BaseNodeResourceType.App:
        return PinType.App;
      default:
        return null;
    }
  }, [resourceType]);

  if (!pinType || isAnonymous || isReadOnlyPreview) {
    return null;
  }

  return <StarButton id={resourceId} type={pinType} className="size-3.5" />;
};
