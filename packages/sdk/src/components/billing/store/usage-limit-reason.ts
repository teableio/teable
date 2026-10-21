import { useTranslation } from '../../../context/app/i18n';
import { getLocalizationMessage } from '../../../context/app/queryClient';
import { useUsageLimitModalStore } from './usage-limit-modal';

export interface IUsageLimitReasonDisplay {
  /** Which plan feature was exceeded (UsageFeatureLimit value, 'credit', ...). */
  feature?: string;
  /** Localized sentence describing which plan limit was hit. */
  message: string;
  /** Plan quota for the exceeded resource, when the backend reported it. */
  limit?: number;
  /** Current usage of the exceeded resource, when the backend reported it. */
  current?: number;
  /** Rows the rejected operation attempted to add (e.g. a bulk paste). */
  increment?: number;
}

/**
 * Why the usage-limit modal opened, resolved for display: a localized message
 * plus the usage numbers for rendering a usage meter. Returns undefined when
 * the modal was opened without a captured reason (feature-gate badges etc.).
 *
 * Lives in the SDK so both the CE and EE modals resolve the localization with
 * the SDK's own i18n typing.
 */
export const useUsageLimitReasonDisplay = (): IUsageLimitReasonDisplay | undefined => {
  const { t } = useTranslation();
  const reason = useUsageLimitModalStore((state) => state.reason);
  if (!reason) return undefined;

  let message = reason.message;
  if (reason.localization) {
    message = getLocalizationMessage(reason.localization, t);
  }
  if (!message) return undefined;

  return {
    feature: reason.feature,
    message,
    limit: reason.limit,
    current: reason.current,
    increment: reason.increment,
  };
};
