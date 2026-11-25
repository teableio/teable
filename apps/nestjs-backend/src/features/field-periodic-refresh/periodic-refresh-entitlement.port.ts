import { HttpErrorCode } from '@teable/core';
import { CustomHttpException } from '../../custom.exception';

export const PERIODIC_REFRESH_ENTITLEMENT_PORT = Symbol('PERIODIC_REFRESH_ENTITLEMENT_PORT');

export interface IPeriodicRefreshEntitlementPort {
  canAutoRefreshSpace(spaceId: string): Promise<boolean>;
  assertAutoRefreshAllowed(spaceId: string): Promise<void>;
}

/**
 * Community Edition ships no scheduled processor, so automatic periodic refresh
 * fails closed unless an EE/Cloud entitlement provider overrides this port.
 */
export const defaultPeriodicRefreshEntitlementPort: IPeriodicRefreshEntitlementPort = {
  async canAutoRefreshSpace() {
    return false;
  },
  assertAutoRefreshAllowed: () =>
    Promise.reject(
      new CustomHttpException(
        'Scheduled automatic field refresh requires Enterprise Edition or Cloud Business plan',
        HttpErrorCode.PAYMENT_REQUIRED
      )
    ),
};
