import {
  ComputedActivityRealtimeProjection,
  FieldCreatedRealtimeProjection,
  FieldDeletedRealtimeProjection,
  FieldOptionsAddedRealtimeProjection,
  FieldUpdatedRealtimeProjection,
  RecordCreatedRealtimeProjection,
  RecordReorderedRealtimeProjection,
  RecordsBatchCreatedRealtimeProjection,
  RecordsBatchUpdatedRealtimeProjection,
  RecordsDeletedRealtimeProjection,
  RecordUpdatedRealtimeProjection,
  TableCreatedRealtimeProjection,
  TableDeletedRealtimeProjection,
  TableProvisionReadyRealtimeProjection,
  type IRealtimeEngine,
  v2CoreTokens,
  ViewColumnMetaUpdatedRealtimeProjection,
  ViewCreatedRealtimeProjection,
  ViewDeletedRealtimeProjection,
  ViewDescriptionUpdatedRealtimeProjection,
  ViewFilterUpdatedRealtimeProjection,
  ViewGroupUpdatedRealtimeProjection,
  ViewLockedUpdatedRealtimeProjection,
  ViewManualSortAppliedRealtimeProjection,
  ViewOptionsUpdatedRealtimeProjection,
  ViewOrderUpdatedRealtimeProjection,
  ViewRenamedRealtimeProjection,
  ViewShareIdRefreshedRealtimeProjection,
  ViewShareMetaUpdatedRealtimeProjection,
  ViewShareDisabledRealtimeProjection,
  ViewShareEnabledRealtimeProjection,
  ViewSortUpdatedRealtimeProjection,
} from '@teable/v2-core';
import { Lifecycle, type DependencyContainer } from '@teable/v2-di';

/** Registers the selected realtime engine and the core projections that feed it. */
export const registerRealtime = (
  container: DependencyContainer,
  engine: IRealtimeEngine
): DependencyContainer => {
  container.registerInstance(v2CoreTokens.realtimeEngine, engine);

  container.register(TableCreatedRealtimeProjection, TableCreatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(TableProvisionReadyRealtimeProjection, TableProvisionReadyRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(TableDeletedRealtimeProjection, TableDeletedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(FieldCreatedRealtimeProjection, FieldCreatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(FieldUpdatedRealtimeProjection, FieldUpdatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(FieldOptionsAddedRealtimeProjection, FieldOptionsAddedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(FieldDeletedRealtimeProjection, FieldDeletedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(ViewCreatedRealtimeProjection, ViewCreatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(ViewDeletedRealtimeProjection, ViewDeletedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(ViewRenamedRealtimeProjection, ViewRenamedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(
    ViewDescriptionUpdatedRealtimeProjection,
    ViewDescriptionUpdatedRealtimeProjection,
    {
      lifecycle: Lifecycle.Singleton,
    }
  );
  container.register(ViewLockedUpdatedRealtimeProjection, ViewLockedUpdatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(ViewOrderUpdatedRealtimeProjection, ViewOrderUpdatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(ViewOptionsUpdatedRealtimeProjection, ViewOptionsUpdatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(ViewFilterUpdatedRealtimeProjection, ViewFilterUpdatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(ViewSortUpdatedRealtimeProjection, ViewSortUpdatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(ViewGroupUpdatedRealtimeProjection, ViewGroupUpdatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(
    ViewColumnMetaUpdatedRealtimeProjection,
    ViewColumnMetaUpdatedRealtimeProjection,
    {
      lifecycle: Lifecycle.Singleton,
    }
  );
  container.register(
    ViewManualSortAppliedRealtimeProjection,
    ViewManualSortAppliedRealtimeProjection,
    {
      lifecycle: Lifecycle.Singleton,
    }
  );
  container.register(ViewShareEnabledRealtimeProjection, ViewShareEnabledRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(ViewShareDisabledRealtimeProjection, ViewShareDisabledRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(
    ViewShareMetaUpdatedRealtimeProjection,
    ViewShareMetaUpdatedRealtimeProjection,
    {
      lifecycle: Lifecycle.Singleton,
    }
  );
  container.register(
    ViewShareIdRefreshedRealtimeProjection,
    ViewShareIdRefreshedRealtimeProjection,
    {
      lifecycle: Lifecycle.Singleton,
    }
  );
  container.register(RecordCreatedRealtimeProjection, RecordCreatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(RecordUpdatedRealtimeProjection, RecordUpdatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(RecordReorderedRealtimeProjection, RecordReorderedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(RecordsBatchCreatedRealtimeProjection, RecordsBatchCreatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(RecordsBatchUpdatedRealtimeProjection, RecordsBatchUpdatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(RecordsDeletedRealtimeProjection, RecordsDeletedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(ComputedActivityRealtimeProjection, ComputedActivityRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });

  return container;
};
