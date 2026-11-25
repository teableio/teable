import { SetMetadata } from '@nestjs/common';

export const IS_ALLOW_BASE_SHARE = 'isAllowBaseShare';

export const BASE_SHARE_DENIED_MESSAGE = 'This endpoint cannot be used through a project share';

/**
 * Opens a project-level route (one whose resource is the base id) to a project share.
 *
 * A share is checked against the base alone on such a route, whichever node it was made
 * for, so PermissionGuard refuses the share on every project-level route without this mark.
 * Mark only routes the share pages call, and make each one answer for the share alone:
 * the guard checks a table, app, workflow or routine named in the path against the share,
 * and anything the route lists has to be filtered to the share.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const AllowBaseShare = () => SetMetadata(IS_ALLOW_BASE_SHARE, true);
