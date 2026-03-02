import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { FieldId } from '../fields/FieldId';
import type { Field } from '../fields/Field';
import type { FieldDeletionContext } from '../OnTeableFieldDeleted';
import type { ViewColumnMeta } from './ViewColumnMeta';
import type { ViewId } from './ViewId';
import type { ViewQueryDefaults } from './ViewQueryDefaults';

export type ViewFieldDeletionUpdate = {
  viewId: ViewId;
  fieldId: FieldId;
  columnMeta?: ViewColumnMeta;
  queryDefaults?: ViewQueryDefaults;
};

export interface OnTeableViewFieldDeleted {
  onFieldDeleted(
    deletedField: Field,
    context: FieldDeletionContext
  ): Result<ViewFieldDeletionUpdate | undefined, DomainError>;
}

export function implementsOnTeableViewFieldDeleted(
  entity: unknown
): entity is OnTeableViewFieldDeleted {
  return (
    entity != null &&
    typeof entity === 'object' &&
    'onFieldDeleted' in entity &&
    typeof (entity as OnTeableViewFieldDeleted).onFieldDeleted === 'function'
  );
}
