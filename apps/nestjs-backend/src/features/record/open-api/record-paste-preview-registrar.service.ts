import { Injectable } from '@nestjs/common';
import { pasteRoSchema, type IPasteRo } from '@teable/openapi';
import {
  PreviewPlannerRegistry,
  RecordsPastePreviewPlanner,
  v2CommandExplainTokens,
  type HostPreviewRegistration,
  type IHostPreviewAdapter,
  type OperationPreviewPlan,
  type PreviewOptions,
} from '@teable/v2-command-explain';
import {
  domainError,
  PasteCommand,
  v2CoreTokens,
  type DomainError,
  type IExecutionContext,
  type PastePreparationService,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';
import {
  V2ProjectionRegistrar,
  type IV2ProjectionRegistrar,
} from '../../v2/v2-projection-registrar';
import { RecordOpenApiV2Service } from './record-open-api-v2.service';

type RecordsPasteHostPreviewInput = {
  readonly tableId: string;
  readonly pasteRo: IPasteRo;
};

const invalidInput = (): Result<never, DomainError> =>
  err(
    domainError.validation({
      code: 'preview.records.paste.invalid_host_input',
      message: 'Paste preview input does not match the mounted write route.',
    })
  );

export const parseRecordsPasteHostPreviewInput = (
  input: unknown
): Result<RecordsPasteHostPreviewInput, DomainError> => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return invalidInput();
  const { tableId, ...body } = input as Record<string, unknown>;
  if (typeof tableId !== 'string') return invalidInput();
  const parsed = pasteRoSchema.safeParse(body);
  return parsed.success ? ok({ tableId, pasteRo: parsed.data }) : invalidInput();
};

export class RecordsPasteHostPreviewPlanner
  implements IHostPreviewAdapter<RecordsPasteHostPreviewInput>
{
  readonly operation = 'records.paste' as const;
  readonly concerns = [] as const;
  readonly plannerVersion = 'records-paste-host-v1';
  readonly executionPath = 'RecordOpenApiV2Service.preparePastePreviewCommandInput/PasteHandler';

  constructor(
    private readonly corePlanner: RecordsPastePreviewPlanner,
    private readonly recordService: RecordOpenApiV2Service
  ) {}

  async preview(
    context: IExecutionContext,
    input: RecordsPasteHostPreviewInput,
    options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>> {
    let commandInput: unknown;
    try {
      commandInput = await this.recordService.preparePastePreviewCommandInput(
        input.tableId,
        input.pasteRo
      );
    } catch {
      return err(
        domainError.validation({
          code: 'preview.records.paste.host_preflight_failed',
          message: 'Unable to normalize the paste request without executing the write.',
        })
      );
    }

    const command = PasteCommand.create(commandInput);
    if (command.isErr()) return err(command.error);
    return this.corePlanner.preview(context, command.value, options);
  }
}

export const createRecordsPasteHostRegistration = (
  planner: RecordsPasteHostPreviewPlanner
): HostPreviewRegistration<RecordsPasteHostPreviewInput> => ({
  operation: 'records.paste',
  parseInput: parseRecordsPasteHostPreviewInput,
  planner,
  priority: 10,
  capability: {
    canonicalWriteRoute: 'PATCH /table/{tableId}/selection/paste',
    supportLevel: 'partial',
    requiredPermissionScope: 'record:update',
    detailLevels: ['summary', 'full'],
    limitations: [
      'The mounted route default-view, range, filter, search, projection, and permission-derived expansion rules are normalized before planning.',
      'Record query and write execution plugins are not invoked by preview.',
      'Affected rows and link auto-created records remain unknown until execution.',
    ],
  },
});

@V2ProjectionRegistrar()
@Injectable()
export class RecordsPastePreviewRegistrar implements IV2ProjectionRegistrar {
  constructor(private readonly recordService: RecordOpenApiV2Service) {}

  registerProjections(container: DependencyContainer): void {
    const preparation = container.resolve<PastePreparationService>(
      v2CoreTokens.pastePreparationService
    );
    const registry = container.resolve<PreviewPlannerRegistry>(
      v2CommandExplainTokens.previewPlannerRegistry
    );
    const result = registry.registerHost(
      createRecordsPasteHostRegistration(
        new RecordsPasteHostPreviewPlanner(
          new RecordsPastePreviewPlanner(preparation),
          this.recordService
        )
      )
    );
    if (result.isErr()) throw new Error(result.error.message);
  }
}
