import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { View } from './View';
import { ViewAuditMetadata, type ViewAuditMetadataValue } from './ViewAuditMetadata';
import { ViewColumnMeta, type ViewColumnMetaValue } from './ViewColumnMeta';
import { createView } from './ViewFactory';
import { ViewId } from './ViewId';
import { ViewName } from './ViewName';
import { ViewOrder } from './ViewOrder';
import { ViewProperties, type ViewPropertiesValue } from './ViewProperties';
import { ViewQueryDefaults, type ViewQueryDefaultsDTO } from './ViewQueryDefaults';
import type { IViewTypeLiteral } from './ViewType';

export type ViewSnapshotValue = {
  readonly id: string;
  readonly name: string;
  readonly type: IViewTypeLiteral;
  readonly order?: number;
  readonly properties: ViewPropertiesValue;
  readonly columnMeta: ViewColumnMetaValue;
  readonly query: ViewQueryDefaultsDTO;
  readonly sourceFilter?: unknown;
  readonly options?: unknown;
  readonly auditMetadata?: ViewAuditMetadataValue;
};

/**
 * Public share credentials are lifecycle state, not replayable View
 * configuration. Keeping them out of generic snapshots ensures undo/redo can
 * never reactivate a credential that was revoked after the snapshot was
 * written.
 */
const replaySafeProperties = ({
  enableShare: _enableShare,
  shareId: _shareId,
  ...properties
}: ViewPropertiesValue): ViewPropertiesValue => properties;

export const captureViewSnapshot = (view: View): Result<ViewSnapshotValue, DomainError> =>
  safeTry<ViewSnapshotValue, DomainError>(function* () {
    const columnMeta = yield* view.columnMeta();
    const query = yield* view.queryDefaults();
    const orderResult = view.order();
    const auditMetadataResult = view.auditMetadata();

    return ok({
      id: view.id().toString(),
      name: view.name().toString(),
      type: view.type().toString(),
      ...(orderResult.isOk() ? { order: orderResult.value.toNumber() } : {}),
      properties: replaySafeProperties(view.properties().toDto()),
      columnMeta: columnMeta.toDto(),
      query: query.toDto(),
      ...(query.sourceFilter() !== undefined ? { sourceFilter: query.sourceFilter() } : {}),
      ...(view.options() !== undefined ? { options: view.options() } : {}),
      ...(auditMetadataResult.isOk() ? { auditMetadata: auditMetadataResult.value.toDto() } : {}),
    });
  });

export const rehydrateViewSnapshot = (snapshot: ViewSnapshotValue): Result<View, DomainError> =>
  safeTry<View, DomainError>(function* () {
    const id = yield* ViewId.create(snapshot.id);
    const name = yield* ViewName.create(snapshot.name);
    // Sanitize again so undo entries captured before this invariant was added
    // cannot restore a stale shareId.
    const properties = yield* ViewProperties.rehydrate(replaySafeProperties(snapshot.properties));
    const view = yield* createView({
      id,
      name,
      type: snapshot.type,
      properties,
    });

    yield* view.setColumnMeta(yield* ViewColumnMeta.rehydrate(snapshot.columnMeta));
    yield* view.setQueryDefaults(
      yield* ViewQueryDefaults.rehydrate(snapshot.query, {
        sourceFilter: snapshot.sourceFilter,
      })
    );
    yield* view.setOptions(snapshot.options);

    if (snapshot.order !== undefined) {
      yield* view.setOrder(yield* ViewOrder.rehydrate(snapshot.order));
    }
    if (snapshot.auditMetadata) {
      yield* view.setAuditMetadata(yield* ViewAuditMetadata.rehydrate(snapshot.auditMetadata));
    }

    return ok(view);
  });
