import { createChildContainer } from '@teable/v2-di';
import { describe, expect, it } from 'vitest';

import type { ISchemaOperationHandler } from '../application/services/SchemaOperationRunnerService';
import type { IFieldOperationPlugin } from '../ports/FieldOperationPlugin';
import { v2CoreTokens } from '../ports/tokens';
import { registerV2CoreServices } from './registerCoreServices';

describe('registerV2CoreServices', () => {
  it('registers the built-in table field limit plugin only once', () => {
    const container = createChildContainer();

    registerV2CoreServices(container);
    registerV2CoreServices(container);

    const plugins = container.resolve<IFieldOperationPlugin[]>(v2CoreTokens.fieldOperationPlugins);

    expect(plugins.filter((plugin) => plugin.name === 'table-field-limit')).toHaveLength(1);
  });

  it('registers schema operation handlers as an overridable collection', () => {
    const container = createChildContainer();

    registerV2CoreServices(container);
    registerV2CoreServices(container);

    const handlers = container.resolve<ISchemaOperationHandler[]>(
      v2CoreTokens.schemaOperationHandlers
    );

    expect(handlers).toEqual([]);
  });
});
