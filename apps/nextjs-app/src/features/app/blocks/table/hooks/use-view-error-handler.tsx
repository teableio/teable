import { HttpError, HttpErrorCode } from '@teable/core';
import { BaseNodeResourceType, getViewList } from '@teable/openapi';
import {
  useBaseId,
  useConnection,
  useIsReadOnlyPreview,
  useTableId,
  useViewId,
  useViews,
} from '@teable/sdk/hooks';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect } from 'react';
import type { ConnectionReceiveRequest } from 'sharedb/lib/sharedb';
import { useShareUrlPrefix } from '@/features/app/context/ShareContext';
import { tableConfig } from '@/features/i18n/table.config';
import { getNodeUrl } from '../../base/base-node/hooks';
import { isStaleViewAnchor, STALE_VIEW_PARAM } from './stale-view-fallback';

const anchorKey = (tableId: string, viewId: string) => `${tableId}/${viewId}`;

// Module scope on purpose. Both entry points below call
// useConfirmedViewRedirect, so each holds its own hook instance and a
// per-instance ref could not stop them from confirming the same anchor twice.
const confirmInFlight = new Set<string>();

// The socket error path fires once per failing poll, so an anchor that stays
// broken would otherwise produce a stream of confirmations. A cooldown bounds
// that while keeping a later attempt possible — a confirmation that failed on
// the network must stay retryable.
const CONFIRM_COOLDOWN_MS = 5_000;
const lastConfirmAt = new Map<string, number>();

// One announcement per dead anchor. Both recovery paths — the server-side
// redirect on a full page load and the client-side confirmation on a shallow
// one — can end up describing the same event, and a shared toast id alone
// would still re-show it once the first toast had been dismissed.
const announcedAnchors = new Set<string>();

/**
 * Tell the user, once, that the view the URL asked for is gone and which one
 * they are looking at instead.
 */
const useStaleViewToast = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return useCallback(
    (props: { key: string; viewName: string }) => {
      const { key, viewName } = props;
      if (announcedAnchors.has(key)) return;
      announcedAnchors.add(key);
      toast.info(t('table:view.deletedRecovered.title'), {
        id: 'stale-view-recovery',
        description: t('table:view.deletedRecovered.description', { viewName }),
      });
    },
    [t]
  );
};

/**
 * Confirm a suspect view anchor against the authoritative HTTP view list
 * and, only when it is truly gone, replace the route with the table's first
 * view. The confirmation round trip is what separates "deleted" from "not
 * delivered yet": a freshly created or duplicated view is anchored by the URL
 * before its sharedb insert reaches the subscription, and must not be treated
 * as deleted. It also makes an imprecise trigger safe — the worst a false
 * suspicion costs is this one request.
 */
const useConfirmedViewRedirect = () => {
  const router = useRouter();
  const notifyStaleView = useStaleViewToast();
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const shareUrlPrefix = useShareUrlPrefix();

  return useCallback(
    async (props: { baseId: string; tableId: string; suspectViewId: string }) => {
      const { baseId, tableId, suspectViewId } = props;
      // Share/template anchors are fixed by their config — never rewrite them
      if (isReadOnlyPreview || shareUrlPrefix) return;
      const key = anchorKey(tableId, suspectViewId);
      if (confirmInFlight.has(key)) return;
      const lastAt = lastConfirmAt.get(key);
      if (lastAt !== undefined && Date.now() - lastAt < CONFIRM_COOLDOWN_MS) return;
      confirmInFlight.add(key);
      try {
        const viewList = (await getViewList(tableId)).data;
        // the anchor exists after all (e.g. just created) — let the
        // subscription catch up instead of redirecting
        if (viewList.some((view) => view.id === suspectViewId)) return;
        const targetView = viewList[0];
        // no view left at all — the no-view empty state owns this case
        if (!targetView) return;
        // the user navigated away while we confirmed — don't compete
        if (!router.asPath.includes(`/${tableId}/${suspectViewId}`)) return;
        const url = getNodeUrl({
          baseId,
          resourceType: BaseNodeResourceType.Table,
          resourceId: tableId,
          viewId: targetView.id,
        });
        if (!url) return;
        notifyStaleView({ key, viewName: targetView.name });
        // replace, not push: Back must not step into the deleted view again
        router.replace(url, undefined, { shallow: true });
      } catch {
        // the list fetch failed (table gone, network down) — a view-level
        // redirect can't be decided; the next trigger past the cooldown
        // retries, and a full page load is validated by getServerSideProps
      } finally {
        confirmInFlight.delete(key);
        // start the cooldown when the attempt settles, not when it began
        lastConfirmAt.set(key, Date.now());
      }
    },
    [router, notifyStaleView, isReadOnlyPreview, shareUrlPrefix]
  );
};

/**
 * Recover from a socket error that reports the anchored view as missing.
 *
 * This covers what list reconciliation cannot: if the subscription never
 * delivers the deletion op, the view list keeps a ghost entry and
 * StaleViewRecovery below stays quiet — but every record query still fails
 * against the dead view, and that failure comes back here.
 */
export const useViewErrorHandler = (baseId: string, tableId: string, viewId: string) => {
  const { connection } = useConnection();
  const confirmedViewRedirect = useConfirmedViewRedirect();

  useEffect(() => {
    if (!tableId || !baseId || !connection) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorHandler = (error: any) => {
      const httpError = new HttpError(error, error?.status || 500);
      // Over a socket a missing view can only be recognized by the generic
      // 404 code. The precise signal does exist over HTTP — v2 handlers
      // report `view.not_found` and it surfaces as data.domainCode — but it
      // does not survive the hop: exceptionParse rebuilds the exception from
      // message + code only, and sharedb forwards just {code, message}. So
      // match HttpErrorCode.NOT_FOUND (what the backend actually throws, see
      // record.service getTinyView) plus VIEW_NOT_FOUND, which is defined but
      // never thrown, in case the backend ever narrows it. NOT_FOUND is
      // broad — errors about other resources reach this same connection —
      // but the confirmation step is what decides, so a stray trigger costs
      // one request and never a wrong redirect.
      if (
        httpError.code === HttpErrorCode.VIEW_NOT_FOUND ||
        httpError.code === HttpErrorCode.NOT_FOUND
      ) {
        confirmedViewRedirect({ baseId, tableId, suspectViewId: viewId });
      }
    };

    const onReceive = (request: ConnectionReceiveRequest) => {
      if (request.data.error) {
        errorHandler(request.data.error);
      }
      // A deletion op for the anchored view needs no handling here: it
      // removes the view from the subscribed query, which trips the
      // list-reconciliation recovery in StaleViewRecovery.
    };
    connection.on('receive', onReceive);

    return () => {
      connection.removeListener('receive', onReceive);
    };
  }, [baseId, connection, confirmedViewRedirect, tableId, viewId]);
};

/**
 * Recover from a URL anchored to a view missing from the loaded view list.
 *
 * The realtime deletion op only reaches windows subscribed to the table at
 * deletion time. A window that was elsewhere can later navigate back through
 * a stale last-visit link and land on the deleted view id: the sidebar
 * navigation is shallow (no getServerSideProps fallback) and nothing below
 * validates the anchor, so the page would sit on a skeleton forever.
 *
 * isStaleViewAnchor only raises the suspicion; the redirect itself is gated
 * on an HTTP confirmation (see useConfirmedViewRedirect), so an anchor the
 * list merely hasn't caught up with is never treated as deleted.
 *
 * Mounted inside ViewProvider but outside PersonalViewProxy: the proxy
 * re-stamps personal-view instances with the current anchor's tableId, which
 * would blunt the mid-table-switch guard in isStaleViewAnchor (the HTTP
 * confirmation would still catch the misjudgment, at the cost of a wasted
 * request).
 */
const useStaleViewRecovery = () => {
  const baseId = useBaseId();
  const tableId = useTableId();
  const viewId = useViewId();
  const views = useViews();
  const confirmedViewRedirect = useConfirmedViewRedirect();

  const suspectStale = isStaleViewAnchor({ views, tableId, viewId });

  useEffect(() => {
    if (!suspectStale || !baseId || !tableId || !viewId) return;
    confirmedViewRedirect({ baseId, tableId, suspectViewId: viewId });
  }, [suspectStale, baseId, tableId, viewId, confirmedViewRedirect]);
};

/**
 * Announce a recovery that getServerSideProps already performed.
 *
 * A full page load — a pasted or shared link, a restored tab, a bookmark —
 * never reaches the recovery above: TablePage validates the anchor server
 * side and redirects before anything renders. Silence there is the most
 * misleading case of all, because the page then looks perfectly healthy
 * while showing a different view than the URL asked for. The redirect leaves
 * STALE_VIEW_PARAM behind to say so; this reads it, announces it once, and
 * strips it so a copied URL cannot replay the message.
 */
const useStaleViewRedirectNotice = () => {
  const router = useRouter();
  const tableId = useTableId();
  const viewId = useViewId();
  const views = useViews();
  const notifyStaleView = useStaleViewToast();

  const staleViewId = router.query[STALE_VIEW_PARAM];
  const landedViewName = views.find((view) => view.id === viewId)?.name;

  useEffect(() => {
    if (typeof staleViewId !== 'string' || !staleViewId || !tableId) return;
    // the message names the view we landed on — wait for the list to hold it
    if (!landedViewName) return;
    notifyStaleView({ key: anchorKey(tableId, staleViewId), viewName: landedViewName });
    const [path, search] = router.asPath.split('?');
    const params = new URLSearchParams(search ?? '');
    params.delete(STALE_VIEW_PARAM);
    const rest = params.toString();
    router.replace(rest ? `${path}?${rest}` : path, undefined, { shallow: true });
  }, [staleViewId, tableId, landedViewName, notifyStaleView, router]);
};

export const StaleViewRecovery = () => {
  useStaleViewRecovery();
  useStaleViewRedirectNotice();
  return null;
};
