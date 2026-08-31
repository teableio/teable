import { ok, type Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { CalendarView } from '../types/CalendarView';
import type { FormView } from '../types/FormView';
import type { GalleryView } from '../types/GalleryView';
import type { GridView } from '../types/GridView';
import type { KanbanView } from '../types/KanbanView';
import type { PluginView } from '../types/PluginView';
import type { View } from '../View';
import {
  createCalendarView,
  createFormView,
  createGalleryView,
  createGridView,
  createKanbanView,
  createPluginView,
} from '../ViewFactory';
import type { ViewFactoryParams } from '../ViewFactory';
import type { ViewName } from '../ViewName';
import type { ViewOrder } from '../ViewOrder';
import type { ViewProperties } from '../ViewProperties';
import type { IViewVisitor } from './IViewVisitor';

export type CloneViewOverrides = {
  readonly name?: ViewName;
  readonly properties?: ViewProperties;
  readonly order?: ViewOrder;
  readonly options?: unknown;
};

export class CloneViewVisitor implements IViewVisitor<View> {
  constructor(private readonly overrides: CloneViewOverrides = {}) {}

  visitGridView(view: GridView): Result<View, DomainError> {
    return this.cloneView(view, createGridView);
  }

  visitKanbanView(view: KanbanView): Result<View, DomainError> {
    return this.cloneView(view, createKanbanView);
  }

  visitGalleryView(view: GalleryView): Result<View, DomainError> {
    return this.cloneView(view, createGalleryView);
  }

  visitCalendarView(view: CalendarView): Result<View, DomainError> {
    return this.cloneView(view, createCalendarView);
  }

  visitFormView(view: FormView): Result<View, DomainError> {
    return this.cloneView(view, createFormView);
  }

  visitPluginView(view: PluginView): Result<View, DomainError> {
    return this.cloneView(view, createPluginView);
  }

  private cloneView(
    view: View,
    factory: (params: ViewFactoryParams) => Result<View, DomainError>
  ): Result<View, DomainError> {
    return factory({
      id: view.id(),
      name: this.overrides.name ?? view.name(),
      properties: this.overrides.properties ?? view.properties(),
    }).andThen((clone) =>
      clone
        .setOptions(
          Object.prototype.hasOwnProperty.call(this.overrides, 'options')
            ? this.overrides.options
            : view.options()
        )
        .andThen(() => {
          const orderResult = this.overrides.order ? ok(this.overrides.order) : view.order();
          return orderResult.isOk() ? clone.setOrder(orderResult.value) : ok(undefined);
        })
        .andThen(() => {
          const auditMetadataResult = view.auditMetadata();
          return auditMetadataResult.isOk()
            ? clone.setAuditMetadata(auditMetadataResult.value)
            : ok(undefined);
        })
        .andThen(() => {
          const versionResult = view.version();
          return versionResult.isOk() ? clone.setVersion(versionResult.value) : ok(undefined);
        })
        .map(() => clone)
    );
  }
}
