import { useQuery } from '@tanstack/react-query';
import type { IUserIntegrationItemVo, UserIntegrationProvider } from '@teable/openapi';
import { getUserIntegrationList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useCallback, useRef, useState } from 'react';
import { useConnectIntegration } from './useConnectIntegration';

const withCredential = (items: IUserIntegrationItemVo[]) => items.filter((item) => item.hasSecret);

/**
 * The accounts a native provider is connected under, and the one a flow reads from.
 *
 * A provider can be connected under several accounts, so a flow that reads from one
 * (an import, a file picker) keeps: every account on file, the account in use, the
 * account whose stored grant the provider refused (it needs the user through the
 * consent screen again — nothing server-side can renew it), and the consent flow
 * itself, for one more account or for that same one.
 */
export const useConnectedAccounts = ({
  provider,
  name,
  queryKey,
  enabled = true,
  onSwitch,
  onConnected,
  onFailed,
}: {
  provider: UserIntegrationProvider;
  /** What the consent popup is titled. */
  name?: string;
  /** Keyed under the user-integrations namespace, so a disconnect elsewhere refetches this. */
  queryKey: string;
  enabled?: boolean;
  /** What the host drops when the account in use changes (a picked file, a chosen base). */
  onSwitch?: () => void;
  /** After consent, with the account that went through it — never whichever the list puts first. */
  onConnected?: (item: IUserIntegrationItemVo) => void;
  onFailed?: (error?: string) => void;
}) => {
  const [chosen, setChosen] = useState<IUserIntegrationItemVo | null>(null);
  const [staleId, setStaleId] = useState<string | null>(null);
  const callbacks = useRef({ onSwitch, onConnected, onFailed });
  callbacks.current = { onSwitch, onConnected, onFailed };

  const query = useQuery({
    queryKey: [...ReactQueryKeys.getUserIntegrations(), queryKey],
    enabled,
    retry: false,
    queryFn: async () =>
      withCredential((await getUserIntegrationList({ provider })).data.integrations),
  });

  const switchAccount = useCallback((item: IUserIntegrationItemVo) => {
    setChosen((current) => {
      if (current?.id === item.id) return current;
      callbacks.current.onSwitch?.();
      return item;
    });
  }, []);

  const adopt = useCallback(
    async (integrationId: string | undefined) => {
      const list = withCredential((await getUserIntegrationList({ provider })).data.integrations);
      const found = list.find((item) => item.id === integrationId) ?? list[0] ?? null;
      if (!found) return;
      // A grant just renewed, or a fresh account: nothing stale is in use any more.
      setStaleId(null);
      switchAccount(found);
      callbacks.current.onConnected?.(found);
    },
    [provider, switchAccount]
  );

  const { connect, isConnecting } = useConnectIntegration({
    onConnected: (_provider, integrationId) => void adopt(integrationId),
    onFailed: (_provider, error) => callbacks.current.onFailed?.(error),
  });

  /** One more account through the provider's consent screen. False when the popup was blocked. */
  const connectAnother = useCallback(
    () => connect(provider, name ? { name } : undefined),
    [connect, provider, name]
  );
  /** The same account through consent again: the row, and every grant on it, stays. */
  const reauthorize = useCallback(
    (item: IUserIntegrationItemVo | null) =>
      item ? connect(provider, { ...(name ? { name } : {}), integrationId: item.id }) : false,
    [connect, provider, name]
  );
  const reset = useCallback(() => {
    setChosen(null);
    setStaleId(null);
  }, []);

  return {
    /** Every account on file with a credential; undefined until read. */
    accounts: query.data,
    isDetecting: query.isFetching,
    detectError: query.error,
    /** The account explicitly chosen (or just connected); the host decides the default. */
    chosen,
    switchAccount,
    /** Mark an account's stored grant as refused by the provider. */
    staleId,
    setStaleId,
    connectAnother,
    reauthorize,
    isConnecting,
    reset,
  };
};
