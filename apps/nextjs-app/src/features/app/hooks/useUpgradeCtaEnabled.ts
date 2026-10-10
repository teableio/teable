import { useEmbedMode } from './useEmbedMode';

/**
 * Whether this surface may render upgrade / purchase calls-to-action: plan
 * badges, "Upgrade" buttons, plan cards, checkout, pricing links, the plan and
 * billing settings entries.
 *
 * Inside the native mobile app's WebView (embed mode) the answer is no. App
 * Store Review Guideline 3.1.3 forbids encouraging, within the app, a
 * purchasing method other than in-app purchase, and Teable sells plans on the
 * web. In embed mode a limit hit therefore only states the constraint (which
 * limit, current usage) and never points at a purchase; every place that would
 * otherwise steer to one consults this hook instead of branching on
 * `useEmbedMode` directly, so the policy has a single home.
 */
export const useUpgradeCtaEnabled = (): boolean => !useEmbedMode();
