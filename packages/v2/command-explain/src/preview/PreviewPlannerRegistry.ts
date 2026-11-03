import { err, ok, type Result } from 'neverthrow';
import { domainError, type DomainError, type IExecutionContext } from '@teable/v2-core';

import type { HostPreviewRegistration } from './HostPreviewAdapter';
import { isPreviewOperation } from './types';
import type {
  OperationPreviewPlan,
  PreviewCapability,
  PreviewOperation,
  PreviewOperationRegistration,
  PreviewOptions,
} from './types';

type RegisteredPreviewOperation = {
  readonly operation: PreviewOperation;
  readonly plannerVersion: string;
  readonly executionPath: string;
  readonly capability: PreviewCapability;
  plan(
    context: IExecutionContext,
    input: unknown,
    options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>>;
};

const bindRegistration = <TInput>(
  registration: PreviewOperationRegistration<TInput>
): RegisteredPreviewOperation => ({
  operation: registration.operation,
  plannerVersion: registration.planner.plannerVersion,
  executionPath: registration.planner.executionPath,
  capability: {
    operation: registration.operation,
    ...registration.capability,
  },
  async plan(context, input, options) {
    const parsed = registration.parseInput(input);
    if (parsed.isErr()) return err(parsed.error);
    return registration.planner.preview(context, parsed.value, options);
  },
});

export class PreviewPlannerRegistry {
  private constructor(
    private readonly entries: Map<PreviewOperation, RegisteredPreviewOperation>,
    private readonly hostPriorities: Map<PreviewOperation, number>
  ) {}

  static empty(): PreviewPlannerRegistry {
    return new PreviewPlannerRegistry(new Map(), new Map());
  }

  static create<TInput>(
    registrations: ReadonlyArray<PreviewOperationRegistration<TInput>>
  ): Result<PreviewPlannerRegistry, DomainError> {
    const registry = PreviewPlannerRegistry.empty();
    for (const registration of registrations) {
      const registered = registry.register(registration);
      if (registered.isErr()) return err(registered.error);
    }
    return ok(registry);
  }

  register<TInput>(registration: PreviewOperationRegistration<TInput>): Result<void, DomainError> {
    if (registration.operation !== registration.planner.operation) {
      return err(
        domainError.validation({
          code: 'preview.operation.registration_mismatch',
          message: `Preview registration ${registration.operation} does not match planner ${registration.planner.operation}`,
        })
      );
    }
    if (this.entries.has(registration.operation)) {
      return err(
        domainError.conflict({
          code: 'preview.operation.duplicate_registration',
          message: `Preview operation is already registered: ${registration.operation}`,
        })
      );
    }
    this.entries.set(registration.operation, bindRegistration(registration));
    return ok(undefined);
  }

  /**
   * Registers a host-owned operation or a host-enriched replacement for a core
   * operation. Repeated module imports are idempotent; the highest edition rank
   * wins regardless of Nest discovery order.
   */
  registerHost<TInput>(registration: HostPreviewRegistration<TInput>): Result<void, DomainError> {
    if (registration.operation !== registration.planner.operation) {
      return err(
        domainError.validation({
          code: 'preview.operation.registration_mismatch',
          message: `Preview registration ${registration.operation} does not match planner ${registration.planner.operation}`,
        })
      );
    }

    const currentPriority = this.hostPriorities.get(registration.operation);
    if (currentPriority !== undefined && currentPriority >= registration.priority) {
      return ok(undefined);
    }

    this.entries.set(registration.operation, bindRegistration(registration));
    this.hostPriorities.set(registration.operation, registration.priority);
    return ok(undefined);
  }

  resolve(operation: string): Result<RegisteredPreviewOperation, DomainError> {
    if (isPreviewOperation(operation)) {
      const entry = this.entries.get(operation);
      if (entry) return ok(entry);
    }
    return err(
      domainError.validation({
        code: 'preview.operation.unsupported',
        message: `Unsupported preview operation: ${operation}`,
      })
    );
  }

  capabilities(): ReadonlyArray<PreviewCapability> {
    return [...this.entries.values()]
      .map((entry) => entry.capability)
      .sort((left, right) => left.operation.localeCompare(right.operation));
  }
}
