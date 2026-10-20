import { BaseNodeResourceType, PinType } from '@teable/openapi';
import { useIsAnonymous, useIsReadOnlyPreview } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { StarButton } from '../../space/space-side-bar/StarButton';

interface IBaseNodeStarButtonProps {
  resourceType: BaseNodeResourceType;
  resourceId: string;
  className?: string;
}

/** The pin type of a node that can be pinned; folders can't. */
export const getNodePinType = (resourceType: BaseNodeResourceType): PinType | null => {
  switch (resourceType) {
    case BaseNodeResourceType.Table:
      return PinType.Table;
    case BaseNodeResourceType.Dashboard:
      return PinType.Dashboard;
    case BaseNodeResourceType.Workflow:
      return PinType.Workflow;
    case BaseNodeResourceType.App:
      return PinType.App;
    case BaseNodeResourceType.Routine:
      return PinType.Routine;
    default:
      return null;
  }
};

export const BaseNodeStarButton = (props: IBaseNodeStarButtonProps) => {
  const { resourceType, resourceId, className } = props;
  const isAnonymous = useIsAnonymous();
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const pinType = getNodePinType(resourceType);

  if (!pinType || isAnonymous || isReadOnlyPreview) {
    return null;
  }

  return <StarButton id={resourceId} type={pinType} className={cn('size-3.5', className)} />;
};
