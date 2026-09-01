import { HttpError, HttpErrorCode } from '@teable/core';
import { getTableList } from '@teable/openapi';
import { useConnection, useIsReadOnlyPreview, useTables } from '@teable/sdk/hooks';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useRef } from 'react';
import type { ConnectionReceiveRequest } from 'sharedb/lib/sharedb';
import { useShareUrlPrefix } from '@/features/app/context/ShareContext';
import { tableConfig } from '@/features/i18n/table.config';
import {
  isStaleTableAnchor,
  locallyDeletedRemainingMs,
  unmarkTableDeletedLocally,
  wasTableDeletedLocally,
} from './stale-table-fallback';

const anchorKey = (baseId: string, tableId: string) => `${baseId}/${tableId}`;

// Module scope on purpose. Both entry points below call
// useConfirmedTableRedirect, so each holds its own hook instance and a
// per-instance ref could not stop them from confirming the same anchor twice.
const confirmInFlight = new Set<string>();

// The socket error path fires once per failing request, so an anchor that
// stays broken would otherwise produce a stream of confirmations. A cooldown
// bounds that while keeping a later attempt possible — a confirmation that
// failed on the network must stay retryable.
const CONFIRM_COOLDOWN_MS = 5_000;
const lastConfirmAt = new Map<string, number>();

// One announcement per dead anchor: several triggers (list reconciliation,
// repeated socket errors) can describe the same deletion, and a shared toast
// id alone would still re-show it once the first toast had been dismissed.
const announcedAnchors = new Set<string>();

// A trigger suppressed by the cooldown or the local-deletion mark may be the
// only one its deletion ever produces: the list-removal event fires exactly
// once, and nothing guarantees a later socket error. Dropping it would strand
// the user on the dead table — e.g. when the deletion's own socket errors
// confirm a beat before the transaction commits ("still exists", cooldown
// starts) and the list removal then lands inside that cooldown. So a
// suppressed trigger books a retry for when its suppression lapses; the
// retry re-runs the full confirmation, whose asPath guard keeps it silent
// whenever the user (deleting or not) has moved on by then.
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const RETRY_SLACK_MS = 50;

const scheduleConfirmRetry = (key: string, delayMs: number, retry: () => void) => {
  if (retryTimers.has(key)) return;
  retryTimers.set(
    key,
    setTimeout(() => {
      retryTimers.delete(key);
      retry();
    }, delayMs + RETRY_SLACK_MS)
  );
};

/**
 * Tell the user, once, that the table they were on is gone and where they
 * landed instead.
 */
const useStaleTableToast = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return useCallback(
    (props: { key: string; landedTableName?: string }) => {
      const { key, landedTableName } = props;
      if (announcedAnchors.has(key)) return;
      announcedAnchors.add(key);
      toast.info(t('table:table.deletedRecovered.title'), {
        id: 'stale-table-recovery',
        description: landedTableName
          ? t('table:table.deletedRecovered.description', { tableName: landedTableName })
          : t('table:table.deletedRecovered.descriptionEmpty'),
      });
    },
    [t]
  );
};

/**
 * Confirm a suspect table anchor against the authoritative HTTP table list
 * and, only when it is truly gone, replace the route with the base's first
 * table (or the base page when none is left). The confirmation round trip is
 * what separates "deleted" from "not delivered yet": a freshly created or
 * duplicated table is anchored by the URL before its realtime insert reaches
 * the subscription, and must not be treated as deleted. It also makes an
 * imprecise trigger safe — the worst a false suspicion costs is this one
 * request.
 */
const useConfirmedTableRedirect = () => {
  const router = useRouter();
  const notifyStaleTable = useStaleTableToast();
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const shareUrlPrefix = useShareUrlPrefix();

  return useCallback(
    async function confirmTableAnchor(props: { baseId: string; suspectTableId: string }) {
      const { baseId, suspectTableId } = props;
      // Share/template anchors are fixed by their config — never rewrite them
      if (isReadOnlyPreview || shareUrlPrefix) return;
      const key = anchorKey(baseId, suspectTableId);
      // This window deleted the table itself: its delete flow owns the
      // navigation away, and telling the actor "your table was deleted"
      // would be both redundant and, until their navigation lands, a
      // competing redirect. The asPath check below cannot catch this — a
      // non-shallow success navigation keeps the old URL until gSSP returns.
      if (wasTableDeletedLocally(suspectTableId)) {
        scheduleConfirmRetry(key, locallyDeletedRemainingMs(suspectTableId), () =>
          confirmTableAnchor(props)
        );
        return;
      }
      if (confirmInFlight.has(key)) {
        // the running attempt may have read the list before the deletion
        // committed — retry once its cooldown lapses (chains into the
        // cooldown branch below for the exact remaining wait)
        scheduleConfirmRetry(key, CONFIRM_COOLDOWN_MS, () => confirmTableAnchor(props));
        return;
      }
      const lastAt = lastConfirmAt.get(key);
      if (lastAt !== undefined && Date.now() - lastAt < CONFIRM_COOLDOWN_MS) {
        scheduleConfirmRetry(key, lastAt + CONFIRM_COOLDOWN_MS - Date.now(), () =>
          confirmTableAnchor(props)
        );
        return;
      }
      confirmInFlight.add(key);
      try {
        const tableList = (await getTableList(baseId)).data;
        // the anchor exists after all (e.g. just created) — let the
        // subscription catch up instead of redirecting
        if (tableList.some((table) => table.id === suspectTableId)) return;
        // the user navigated away while we confirmed — don't compete
        if (!router.asPath.includes(`/table/${suspectTableId}`)) return;
        const targetTable = tableList[0];
        notifyStaleTable({ key, landedTableName: targetTable?.name });
        // replace, not push: Back must not step into the deleted table again.
        // Non-shallow on purpose — the target URL carries no view segment, so
        // getServerSideProps must resolve the default view (and, when no
        // table is left, the base page resolves its default node).
        router.replace(targetTable ? `/base/${baseId}/table/${targetTable.id}` : `/base/${baseId}`);
      } catch {
        // the list fetch failed (base gone, network down) — nothing to decide
        // here; the next trigger past the cooldown retries, and a full page
        // load is validated by getServerSideProps
      } finally {
        confirmInFlight.delete(key);
        // start the cooldown when the attempt settles, not when it began
        lastConfirmAt.set(key, Date.now());
      }
    },
    [router, notifyStaleTable, isReadOnlyPreview, shareUrlPrefix]
  );
};

/**
 * Recover from a socket error that reports a missing resource under the
 * anchored table.
 *
 * This covers what list reconciliation cannot: if the subscription never
 * delivers the table's deletion, the table list keeps a ghost entry and
 * useStaleTableRecovery below stays quiet — but every record/view query
 * still fails against the dead table, and that failure comes back here. Over
 * the socket those failures only carry a generic code — NOT_FOUND, or
 * RESTRICTED_RESOURCE from EE's authority guard. Both are broad (a deleted
 * view or a permission denial produces them too) — but the confirmation step
 * is what decides, so a stray trigger costs one request and never a wrong
 * redirect.
 */
export const useTableErrorHandler = (baseId: string, tableId: string) => {
  const { connection } = useConnection();
  const confirmedTableRedirect = useConfirmedTableRedirect();

  useEffect(() => {
    if (!baseId || !tableId || !connection) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorHandler = (error: any) => {
      const httpError = new HttpError(error, error?.status || 500);
      if (
        httpError.code === HttpErrorCode.NOT_FOUND ||
        httpError.code === HttpErrorCode.RESTRICTED_RESOURCE
      ) {
        confirmedTableRedirect({ baseId, suspectTableId: tableId });
      }
    };

    const onReceive = (request: ConnectionReceiveRequest) => {
      if (request.data.error) {
        errorHandler(request.data.error);
      }
    };
    connection.on('receive', onReceive);

    return () => {
      connection.removeListener('receive', onReceive);
    };
  }, [baseId, tableId, connection, confirmedTableRedirect]);
};

/**
 * Recover when the anchored table leaves the subscribed table list — the
 * realtime signal a collaborator receives when someone else deletes the
 * table they are on (v1 saves a Del raw op, v2 publishes it through
 * TableDeletedRealtimeProjection).
 *
 * isStaleTableAnchor only raises the suspicion; the redirect itself is gated
 * on an HTTP confirmation (see useConfirmedTableRedirect), so an anchor the
 * list merely hasn't caught up with is never treated as deleted. The list
 * check cannot judge an empty list — that is also its state before the
 * subscription loads — so deleting the base's last table is recognized by
 * remembering that the anchor was present before the list emptied.
 */
export const useStaleTableRecovery = (baseId: string, tableId: string) => {
  const tables = useTables();
  const confirmedTableRedirect = useConfirmedTableRedirect();

  const anchorSeenRef = useRef(false);
  useEffect(() => {
    anchorSeenRef.current = false;
    // Re-anchoring onto a table this window deleted can only be Back or a
    // stale link (the delete flow only moves away) — clear the mark's veto.
    unmarkTableDeletedLocally(tableId);
  }, [baseId, tableId]);

  // SSR-seeded instances carry no baseId (it is stamped from the sharedb doc,
  // see createTableInstance), but the seed was validated by getServerSideProps
  // for exactly this base — count it as "seen", or deleting the base's only
  // table before the live query becomes ready would leave the empty-list
  // guard unarmed and this window stranded.
  const anchorInList = tables.some(
    (table) => table.id === tableId && (table.baseId === undefined || table.baseId === baseId)
  );

  useEffect(() => {
    if (!baseId || !tableId) return;
    if (anchorInList) {
      anchorSeenRef.current = true;
      return;
    }
    const suspectStale =
      isStaleTableAnchor({ tables, baseId, tableId }) ||
      (anchorSeenRef.current && tables.length === 0);
    if (suspectStale) {
      confirmedTableRedirect({ baseId, suspectTableId: tableId });
    }
  }, [tables, anchorInList, baseId, tableId, confirmedTableRedirect]);
};
