import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../fields/FieldId';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

/**
 * Specification for updating a field's ai_config metadata.
 *
 * ai_config is currently persisted as sidecar metadata (v1-compatible column)
 * and is not modeled on the v2 Field aggregate. Therefore this spec mutates
 * no in-memory table state and is handled by persistence visitors.
 */
export class TableUpdateFieldAiConfigSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousAiConfigValue: unknown | null,
    private readonly nextAiConfigValue: unknown | null
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousAiConfig: unknown | null,
    nextAiConfig: unknown | null
  ): TableUpdateFieldAiConfigSpec {
    return new TableUpdateFieldAiConfigSpec(fieldId, previousAiConfig, nextAiConfig);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  nextAiConfig(): unknown | null {
    return this.nextAiConfigValue;
  }

  previousAiConfig(): unknown | null {
    return this.previousAiConfigValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    return ok(t);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableUpdateFieldAiConfig(this).map(() => undefined);
  }
}
