/**
 * Whether the grid may change the view's shared column layout (order, width,
 * frozen columns) from direct manipulation such as header drag.
 *
 * A locked view keeps its options read-only for everyone; personal mode edits
 * a private copy, so it stays editable there — matching the field menu.
 */
export const canEditViewLayout = ({
  hasViewUpdatePermission,
  isViewLocked,
  isPersonalView,
}: {
  hasViewUpdatePermission: boolean;
  isViewLocked: boolean;
  isPersonalView: boolean;
}): boolean => {
  if (!hasViewUpdatePermission) return false;
  return !isViewLocked || isPersonalView;
};
