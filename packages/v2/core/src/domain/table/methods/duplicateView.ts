import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { generatePrefixedId } from '../../shared/IdGenerator';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import { ViewColumnMeta } from '../views/ViewColumnMeta';
import { createView as createViewEntity } from '../views/ViewFactory';
import type { ViewId } from '../views/ViewId';
import { ViewId as ViewIdValue } from '../views/ViewId';
import { ViewName } from '../views/ViewName';
import { validateViewCreateOptions } from '../views/ViewOptions';
import { ViewProperties } from '../views/ViewProperties';
import { ViewQueryDefaults } from '../views/ViewQueryDefaults';
import { uniqueViewName } from './createView';

export type DuplicateViewPluginOptions = {
  readonly pluginId: string;
  readonly pluginInstallId: string;
  readonly pluginLogo: string;
};

export type DuplicateViewMethodOptions = {
  readonly pluginOptions?: DuplicateViewPluginOptions;
};

export type DuplicateViewMethodResult = {
  readonly view: View;
  readonly updateResult: TableUpdateResult;
};

const shareIdPrefix = 'shr';
const shareIdBodyLength = 16;

export function duplicateView(
  this: Table,
  sourceViewId: ViewId,
  input: DuplicateViewMethodOptions = {}
): Result<DuplicateViewMethodResult, DomainError> {
  const table = this;
  return safeTry<DuplicateViewMethodResult, DomainError>(function* () {
    const source = yield* table.getView(sourceViewId);
    const sourceType = source.type().toString();
    if (sourceType === 'plugin' && input.pluginOptions === undefined) {
      return err(
        domainError.validation({
          message: 'Plugin View duplication requires a prepared Plugin installation',
        })
      );
    }
    if (sourceType !== 'plugin' && input.pluginOptions !== undefined) {
      return err(
        domainError.validation({
          message: 'Plugin options can only be supplied when duplicating a Plugin View',
        })
      );
    }

    const viewId = yield* ViewIdValue.generate();
    const name = yield* ViewName.create(
      uniqueViewName(
        source.name().toString(),
        table.views().map((view) => view.name().toString())
      )
    );
    const propertiesValue = source.properties().toDto();
    const properties = yield* ViewProperties.create({
      ...propertiesValue,
      ...(source.shareId() !== undefined
        ? { shareId: generatePrefixedId(shareIdPrefix, shareIdBodyLength) }
        : {}),
    });
    const view = yield* createViewEntity({
      type: sourceType,
      id: viewId,
      name,
      properties,
    });

    const sourceColumnMeta = yield* source.columnMeta();
    const columnMeta = yield* ViewColumnMeta.create(sourceColumnMeta.toDto());
    yield* view.setColumnMeta(columnMeta);

    const sourceQueryDefaults = yield* source.queryDefaults();
    const queryDefaults = yield* ViewQueryDefaults.create(sourceQueryDefaults.toDto(), {
      sourceFilter: sourceQueryDefaults.sourceFilter(),
    });
    yield* view.setQueryDefaults(queryDefaults);

    const options = yield* validateViewCreateOptions(
      sourceType,
      sourceType === 'plugin' ? input.pluginOptions : source.options()
    );
    yield* view.setOptions(options);

    const updateResult = yield* table.update((mutator) => mutator.addView(view));
    return ok({ view, updateResult });
  });
}
