import type { IUserIntegrationItemVo } from './list';

/**
 * Whether an OAuth attempt for a built-in provider actually produced anything.
 *
 * No surface is told how the attempt ended: a popup is watched from the outside, and an
 * in-app browser resolves the same way whether the user authorized or tapped Done. So
 * "connected" is read from this API afterwards — and read on its own, that answer is whatever
 * the user held ALREADY. Somebody with a connection for the provider who asks for another and
 * then closes the consent screen would be told it worked: the Web's popup would close mid-
 * OAuth, and a card that grants the result would bind the old connection to the resource that
 * asked for a new one.
 *
 * Hence a snapshot taken before the browser opens, and only a change counts. A reconnect
 * reuses the row and bumps `connectedTime` (see `saveIntegration`), so "changed" is a row that
 * is new or whose `connectedTime` advanced.
 */
export type IUserIntegrationBaseline = Record<string, number>;

const connectedAt = (integration: IUserIntegrationItemVo): number =>
  integration.connectedTime ? Date.parse(integration.connectedTime) : 0;

/** What the user holds for this provider right now, to compare an attempt against. */
export const userIntegrationBaseline = (
  integrations: readonly IUserIntegrationItemVo[],
  provider: string
): IUserIntegrationBaseline =>
  Object.fromEntries(
    integrations
      .filter((item) => item.provider === provider)
      .map((item) => [item.id, connectedAt(item)])
  );

/** The connection this attempt produced — new, or reconnected — or nothing when it produced none. */
export const findChangedUserIntegration = (
  integrations: readonly IUserIntegrationItemVo[],
  provider: string,
  baseline: IUserIntegrationBaseline
): IUserIntegrationItemVo | undefined =>
  integrations.find((item) => {
    if (item.provider !== provider || !item.hasSecret) return false;
    const previous = baseline[item.id];
    return previous === undefined || connectedAt(item) > previous;
  });
