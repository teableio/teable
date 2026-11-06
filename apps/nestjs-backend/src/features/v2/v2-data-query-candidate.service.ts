import { createHash } from 'node:crypto';
import { ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { convertFieldRoSchema } from '@teable/core';
import {
  FieldId,
  TableByIdSpec,
  TableId,
  buildFieldDeletionCleanup,
  domainError,
  collectFieldConversionForeignTableReferences,
  UpdateFieldCommand,
  type LinkField,
  LinkForeignTableReferenceVisitor,
  NoopFieldVisitor,
  type LinkForeignTableReference,
  v2CoreTokens,
  type DomainError,
  type FieldConversionPreparationService,
  type FieldConversionPreparation,
  type FieldCrossTableUpdateSideEffectService,
  type FieldDeletionPreparationService,
  type FieldDeletionPreparation,
  type Field,
  type IExecutionContext,
  type IForeignTableLoaderService,
  type ITableMapper,
  type ITableReadModel,
  type ITableRepository,
  Table,
} from '@teable/v2-core';
import { dataQueryCandidateSchema, type DataQueryCandidate } from '@teable/v2-data-query';
import type { DependencyContainer } from '@teable/v2-di';
import { ClsService } from 'nestjs-cls';
import { err, ok, safeTry, type Result } from 'neverthrow';
import type { IClsStore } from '../../types/cls';
import { TeableJwtService } from '../auth/jwt/teable-jwt.service';
import { PermissionService } from '../auth/permission.service';
import { FieldOpenApiV2Service } from '../field/open-api/field-open-api-v2.service';
import { V2ContainerService } from './v2-container.service';
import { dataQueryHostError } from './v2-data-query-http';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';
import { fieldPreviewSource } from './v2-field-preview-input';
import {
  authorizeFieldConversionForeignTables,
  previewAuthorizationDomainError,
  previewForeignTableAuthorizationFailure,
  V2_OPERATION_PREVIEW_AUTHORIZATION,
  type IV2OperationPreviewAuthorization,
} from './v2-operation-preview-authorization';

const audience = 'teable.data-query.candidate';
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left === right ? 0 : 1))
        .map(([key, child]) => [key, canonical(child)])
    );
  }
  return value;
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const candidateDigest = (candidate: DataQueryCandidate) =>
  digest(JSON.stringify(canonical(candidate)));
const forbidden = () =>
  domainError.forbidden({
    code: 'data_query.candidate_forbidden',
    message: 'Candidate validation requires an authorized preview',
  });

class RequiredDeletionForeignReferenceVisitor extends NoopFieldVisitor {
  readonly foreignTableIds = new Set<string>();

  override visitLinkField(field: LinkField): Result<void, DomainError> {
    if (!field.isOneWay()) this.foreignTableIds.add(field.foreignTableId().toString());
    return ok(undefined);
  }
}

export type PreparedFieldPreview = {
  readonly candidate: DataQueryCandidate;
  readonly projectedTables: ReadonlyMap<string, ITableReadModel>;
} & (
  | {
      readonly operation: 'field.delete';
      readonly facts: Result<FieldDeletionPreparation, DomainError>;
    }
  | { readonly operation: 'field.convert'; readonly facts: FieldConversionPreparation }
);

/** Host-only signed admission and canonical, read-only field command preparation. */
@Injectable()
export class V2DataQueryCandidateService {
  private readonly admittedCandidates = new WeakMap<
    ReadonlyMap<string, ITableReadModel>,
    { candidateDigest: string; foreignTableIds: readonly string[] }
  >();
  constructor(
    private readonly containers: V2ContainerService,
    private readonly contexts: V2ExecutionContextFactory,
    private readonly fields: FieldOpenApiV2Service,
    private readonly jwt: TeableJwtService,
    private readonly permissions: PermissionService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  /** Call only after field-operation permission and canonical command preflight succeed. */
  signCandidate(
    candidate: DataQueryCandidate,
    principal: { appId: string; accessToken: string },
    prepared: ReadonlyMap<string, ITableReadModel>
  ): string {
    const admission = this.admittedCandidates.get(prepared);
    if (!admission || admission.candidateDigest !== candidateDigest(candidate)) {
      throw new ForbiddenException('Candidate proof requires a matching editor admission');
    }
    return this.jwt.sign(
      {
        kind: audience,
        appId: principal.appId,
        tokenDigest: digest(principal.accessToken),
        candidateDigest: candidateDigest(candidate),
        foreignTableIds: admission.foreignTableIds,
      },
      { audience, expiresIn: 60, algorithm: 'HS256' }
    );
  }

  async prepareAuthorizedCandidate(
    context: IExecutionContext,
    candidate: DataQueryCandidate,
    proof: string | undefined,
    accessToken: string | undefined
  ): Promise<Result<ReadonlyMap<string, ITableReadModel>, DomainError>> {
    if (!proof || !accessToken) return err(forbidden());
    let admittedForeignTableIds: readonly string[];
    try {
      const claims = this.jwt.verify<{
        kind: string;
        appId: string;
        tokenDigest: string;
        candidateDigest: string;
        exp: number;
        foreignTableIds: string[];
      }>(proof, { audience, algorithms: ['HS256'] });
      if (
        claims.kind !== audience ||
        !claims.appId ||
        claims.appId !== this.cls.get('appId') ||
        !Number.isFinite(claims.exp) ||
        claims.tokenDigest !== digest(accessToken) ||
        claims.candidateDigest !== candidateDigest(candidate) ||
        !Array.isArray(claims.foreignTableIds) ||
        !claims.foreignTableIds.every((id) => typeof id === 'string')
      )
        return err(forbidden());
      admittedForeignTableIds = claims.foreignTableIds;
    } catch {
      return err(forbidden());
    }
    return this.projectCandidate(candidate, context, admittedForeignTableIds);
  }

  /** Editor preflight: no query execution, field-operation plugin, persistence or aggregation. */
  async prepareCandidate(
    raw: unknown,
    executionContext?: IExecutionContext
  ): Promise<Result<ReadonlyMap<string, ITableReadModel>, DomainError>> {
    return this.projectCandidate(raw, executionContext);
  }

  /** One editor-side preparation supplies both canonical facts and the admitted App projection. */
  async preparePreview(
    context: IExecutionContext,
    container: DependencyContainer,
    candidate: DataQueryCandidate,
    sourceInput: unknown
  ): Promise<Result<PreparedFieldPreview, DomainError>> {
    let facts: FieldDeletionPreparation | FieldConversionPreparation | undefined;
    let preparationError: DomainError | undefined;
    const projected = await this.cls.runWith({ ...this.cls.get(), v2PreviewReadOnly: true }, () =>
      this.projectReadOnlyCandidate(candidate, context, undefined, {
        container,
        table: fieldPreviewSource(sourceInput),
        capture: (value) => {
          facts = value;
        },
        captureFailure: (error) => {
          preparationError = error;
        },
      })
    );
    if (candidate.operation === 'delete' && preparationError) {
      return ok({
        operation: 'field.delete',
        candidate,
        projectedTables: new Map(),
        facts: err(preparationError),
      });
    }
    if (projected.isErr()) return err(projected.error);
    if (!facts)
      return err(domainError.infrastructure({ message: 'Field preview preparation unavailable' }));
    if ('missingMetadata' in facts && facts.missingMetadata.length > 0) {
      this.admittedCandidates.delete(projected.value);
    }
    return ok(
      candidate.operation === 'delete'
        ? {
            operation: 'field.delete',
            candidate,
            projectedTables: projected.value,
            facts: ok(facts as FieldDeletionPreparation),
          }
        : {
            operation: 'field.convert',
            candidate,
            projectedTables: projected.value,
            facts: facts as FieldConversionPreparation,
          }
    );
  }

  private async projectCandidate(
    raw: unknown,
    executionContext?: IExecutionContext,
    admittedForeignTableIds?: readonly string[]
  ): Promise<Result<ReadonlyMap<string, ITableReadModel>, DomainError>> {
    return this.cls.runWith({ ...this.cls.get(), v2PreviewReadOnly: true }, () =>
      this.projectReadOnlyCandidate(raw, executionContext, admittedForeignTableIds)
    );
  }

  private async projectReadOnlyCandidate(
    raw: unknown,
    executionContext?: IExecutionContext,
    admittedForeignTableIds?: readonly string[],
    preview?: {
      container: DependencyContainer;
      table?: Table;
      capture: (facts: FieldDeletionPreparation | FieldConversionPreparation) => void;
      captureFailure: (error: DomainError) => void;
    }
  ): Promise<Result<ReadonlyMap<string, ITableReadModel>, DomainError>> {
    try {
      const parsed = dataQueryCandidateSchema.safeParse(raw);
      if (!parsed.success) {
        return err(
          domainError.validation({
            code: 'data_query.invalid_candidate',
            message: 'Invalid field operation candidate',
          })
        );
      }
      const candidate = parsed.data;
      // App validation uses a signed editor grant, never the App actor's schema-write rights.
      const editorAdmission = admittedForeignTableIds === undefined;
      if (editorAdmission) {
        const ceiling = await this.assertTokenCeiling(candidate);
        if (ceiling.isErr()) return err(ceiling.error);
      }
      const container =
        preview?.container ??
        (await this.containers.getPreviewContainerForTable(candidate.tableId));
      if (!container) {
        return err(
          domainError.infrastructure({
            code: 'data_query.candidate_route_unavailable',
            message: 'A current read-only schema route is unavailable for this candidate',
          })
        );
      }
      const context = executionContext ?? (await this.contexts.createContext(container));
      const repository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
      const mapper = container.resolve<ITableMapper>(v2CoreTokens.tableMapper);
      const authorizedForeignIds = new Set<string>();
      const result =
        candidate.operation === 'delete'
          ? await this.prepareDeletionCandidate(
              context,
              container,
              repository,
              candidate.tableId,
              candidate.fieldIds,
              editorAdmission,
              admittedForeignTableIds,
              authorizedForeignIds,
              preview
            )
          : await this.prepareConversionCandidate(
              context,
              container,
              repository,
              mapper,
              candidate,
              editorAdmission,
              admittedForeignTableIds,
              authorizedForeignIds,
              preview
            );
      if (result.isOk() && editorAdmission) {
        this.admittedCandidates.set(result.value, {
          candidateDigest: candidateDigest(candidate),
          foreignTableIds: [...authorizedForeignIds],
        });
      }
      return result;
    } catch (error) {
      return this.candidateFailure(error);
    }
  }

  private async prepareDeletionCandidate(
    context: IExecutionContext,
    container: DependencyContainer,
    repository: Pick<ITableRepository, 'findOne'>,
    tableId: string,
    rawFieldIds: readonly string[],
    editorAdmission: boolean,
    admittedForeignTableIds: readonly string[] | undefined,
    authorizedForeignIds: Set<string>,
    preview?: {
      table?: Table;
      capture: (facts: FieldDeletionPreparation) => void;
      captureFailure: (error: DomainError) => void;
    }
  ): Promise<Result<ReadonlyMap<string, ITableReadModel>, DomainError>> {
    return safeTry(
      async function* (this: V2DataQueryCandidateService) {
        const tableIdValue = yield* TableId.create(tableId);
        const table =
          preview?.table ??
          (yield* await repository.findOne(context, TableByIdSpec.create(tableIdValue)));
        const fieldIds: FieldId[] = [];
        for (const id of rawFieldIds) fieldIds.push(yield* FieldId.create(id));
        const targetFields = [];
        for (const fieldId of fieldIds) {
          targetFields.push(yield* table.getField((field) => field.id().equals(fieldId)));
        }
        const references = yield* new LinkForeignTableReferenceVisitor().collect(targetFields);
        const foreignIds = references.map((reference) => reference.foreignTableId.toString());
        yield* this.assertAdmittedForeignIds(editorAdmission, foreignIds, admittedForeignTableIds);
        let foreignTables: ReadonlyArray<Table> | undefined;
        if (editorAdmission) {
          for (const fieldId of rawFieldIds) {
            yield* await this.authorizeEditor(context, container, table, 'field.delete', {
              baseId: table.baseId().toString(),
              tableId,
              fieldId,
            });
          }
          foreignTables = yield* await this.prepareDeletionForeignTables(
            context,
            container,
            targetFields,
            references,
            authorizedForeignIds,
            preview !== undefined
          );
        } else {
          for (const id of foreignIds) authorizedForeignIds.add(id);
        }
        const prepared = await container
          .resolve<FieldDeletionPreparationService>(v2CoreTokens.fieldDeletionPreparationService)
          .prepare(
            context,
            { baseId: table.baseId(), tableId: tableIdValue, fieldIds },
            { table, foreignTables }
          );
        if (prepared.isErr()) {
          preview?.captureFailure(prepared.error);
          return err(prepared.error);
        }
        const preparation = prepared.value;
        preview?.capture(preparation);
        if (!preview && preparation.missingMetadata.length > 0) {
          return err(
            domainError.infrastructure({
              code: 'data_query.candidate_metadata_unavailable',
              message: 'Cannot construct the complete candidate schema',
            })
          );
        }
        return ok(preparation.projectedTablesById);
      }.bind(this)
    );
  }

  private async prepareDeletionForeignTables(
    context: IExecutionContext,
    container: DependencyContainer,
    targetFields: ReadonlyArray<Field>,
    references: ReadonlyArray<LinkForeignTableReference>,
    authorizedForeignIds: Set<string>,
    allowPartial: boolean
  ): Promise<Result<ReadonlyArray<Table> | undefined, DomainError>> {
    return safeTry<ReadonlyArray<Table> | undefined, DomainError>(
      async function* (this: V2DataQueryCandidateService) {
        if (!allowPartial) {
          const foreignIds = references.map((reference) => reference.foreignTableId.toString());
          yield* await this.authorizeForeignIds(context, container, foreignIds);
          for (const id of foreignIds) authorizedForeignIds.add(id);
          return ok(undefined);
        }
        const requiredTargets = new RequiredDeletionForeignReferenceVisitor();
        for (const field of targetFields) yield* field.accept(requiredTargets);
        const requiredIds = requiredTargets.foreignTableIds;
        const admittedReferences: LinkForeignTableReference[] = [];
        for (const reference of references) {
          const id = reference.foreignTableId.toString();
          const admitted = await this.authorizeForeignIds(context, container, [id]);
          if (admitted.isErr()) {
            if (requiredIds.has(id) || !admitted.error.tags.includes('forbidden'))
              return err(admitted.error);
            // Source-only deletion never mutates its unreadable dependencies. Omitted
            // metadata remains missing evidence and cannot produce a signed candidate.
            continue;
          }
          admittedReferences.push(reference);
          authorizedForeignIds.add(id);
        }
        if (admittedReferences.length === references.length) return ok(undefined);
        if (admittedReferences.length === 0) return ok([]);
        return container
          .resolve<IForeignTableLoaderService>(v2CoreTokens.foreignTableLoaderService)
          .load(context, { references: admittedReferences, allowMissing: true });
      }.bind(this)
    );
  }

  private async prepareConversionCandidate(
    context: IExecutionContext,
    container: DependencyContainer,
    repository: Pick<ITableRepository, 'findOne' | 'find'>,
    mapper: ITableMapper,
    candidate: Extract<DataQueryCandidate, { operation: 'convert' }>,
    editorAdmission: boolean,
    admittedForeignTableIds: readonly string[] | undefined,
    authorizedForeignIds: Set<string>,
    preview?: { table?: Table; capture: (facts: FieldConversionPreparation) => void }
  ): Promise<Result<ReadonlyMap<string, ITableReadModel>, DomainError>> {
    return safeTry(
      async function* (this: V2DataQueryCandidateService) {
        const tableId = yield* TableId.create(candidate.tableId);
        const table =
          preview?.table ??
          (yield* await repository.findOne(context, TableByIdSpec.create(tableId)));
        const fieldId = yield* FieldId.create(candidate.fieldId);
        const previousField = yield* table.getField((field) => field.id().equals(fieldId));
        let input: unknown = candidate;
        if (candidate.inputFormat !== 'field-v2') {
          const field = convertFieldRoSchema.safeParse(candidate.field);
          if (!field.success)
            return err(
              domainError.validation({
                code: 'data_query.invalid_candidate',
                message: 'Invalid field conversion candidate',
              })
            );
          input = yield* this.fields.prepareConvertFieldInput(table, candidate.fieldId, field.data);
        }
        const command = yield* UpdateFieldCommand.create(input, { allowNoop: true });
        const references = yield* collectFieldConversionForeignTableReferences(
          command,
          previousField
        );
        const foreignIds = references.map((reference) => reference.foreignTableId.toString());
        yield* this.assertAdmittedForeignIds(editorAdmission, foreignIds, admittedForeignTableIds);
        if (editorAdmission) {
          yield* await this.authorizeEditor(
            context,
            container,
            table,
            'field.convert',
            input,
            command
          );
          // The general source policy may reload a newer aggregate. Only this
          // explicit check admits the exact references captured from `table`.
          yield* await this.authorizeForeignIds(context, container, foreignIds);
        }
        for (const id of foreignIds) authorizedForeignIds.add(id);
        await this.fields.assertSameSpaceForV2FieldPatch(candidate.tableId, command.fieldUpdate);
        const preparation = yield* await container
          .resolve<FieldConversionPreparationService>(
            v2CoreTokens.fieldConversionPreparationService
          )
          .prepare(context, input, { table });
        preview?.capture(preparation);
        const tables = yield* await this.applyConversionSideEffects(
          context,
          container,
          repository,
          mapper,
          table,
          preparation
        );
        const projectedTable = tables.get(candidate.tableId)!;
        const updatedField = yield* projectedTable.getField(
          (projectedField) => projectedField.id().toString() === candidate.fieldId
        );
        return container
          .resolve<FieldCrossTableUpdateSideEffectService>(
            v2CoreTokens.fieldCrossTableUpdateSideEffectService
          )
          .project(
            context,
            {
              table: projectedTable,
              updatedField,
              updateSpecs: preparation.updateSpecs,
            },
            mapper,
            tables
          );
      }.bind(this)
    );
  }

  private async applyConversionSideEffects(
    context: IExecutionContext,
    container: DependencyContainer,
    repository: Pick<ITableRepository, 'find'>,
    mapper: ITableMapper,
    table: Table,
    preparation: FieldConversionPreparation
  ): Promise<Result<Map<string, Table>, DomainError>> {
    return safeTry(async function* () {
      const tables = new Map<string, Table>([[table.id().toString(), preparation.projectedTable]]);
      for (const effect of preparation.plannedSideEffects) {
        const id = effect.foreignTable.id().toString();
        const detached = yield* (tables.get(id) ?? effect.foreignTable).clone(mapper);
        tables.set(id, yield* effect.mutateSpec.mutate(detached));
      }
      // Conversion may remove a reciprocal link. Apply the same deletion dependency cleanup
      // across detached tables before projecting conversion cascades.
      for (const effect of preparation.plannedSideEffects) {
        const projected = tables.get(effect.foreignTable.id().toString())!;
        const deletedFields = effect.foreignTable
          .getFields()
          .filter((field) =>
            projected.getField((candidateField) => candidateField.id().equals(field.id())).isErr()
          );
        if (deletedFields.length === 0) continue;
        const allTablesSpec = yield* Table.specs(table.baseId()).build();
        const allTables = yield* await repository.find(context, allTablesSpec);
        for (const source of allTables) {
          let current = tables.get(source.id().toString()) ?? (yield* source.clone(mapper));
          for (const deletedField of deletedFields) {
            const cleanup = yield* buildFieldDeletionCleanup(current, deletedField, {
              table: current,
              sourceTable: projected,
              previousSourceTable: effect.foreignTable,
            });
            if (cleanup.spec) current = yield* cleanup.spec.mutate(current);
          }
          tables.set(source.id().toString(), current);
        }
      }
      return ok(tables);
    });
  }

  private assertAdmittedForeignIds(
    editorAdmission: boolean,
    foreignIds: readonly string[],
    admittedForeignTableIds: readonly string[] | undefined
  ): Result<void, DomainError> {
    if (editorAdmission) {
      // Editor admission is established from the captured snapshot, not a later reload.
      return ok(undefined);
    }
    const granted = new Set(admittedForeignTableIds);
    return foreignIds.every((id) => granted.has(id)) ? ok(undefined) : err(forbidden());
  }

  private candidateFailure(
    error: unknown
  ): Result<ReadonlyMap<string, ITableReadModel>, DomainError> {
    if (error instanceof HttpException) return err(dataQueryHostError(error));
    return err(
      domainError.infrastructure({
        code: 'data_query.candidate_preparation_failed',
        message: 'Unable to prepare the field operation candidate',
      })
    );
  }

  private async assertTokenCeiling(
    candidate: DataQueryCandidate
  ): Promise<Result<void, DomainError>> {
    const tokenId = this.cls.get('accessTokenId');
    if (!tokenId) return ok(undefined);
    try {
      const actions = await this.permissions.getPermissionsByAccessToken(
        candidate.tableId,
        tokenId
      );
      const action = candidate.operation === 'delete' ? 'field|delete' : 'field|update';
      return actions.includes(action) ? ok(undefined) : err(previewAuthorizationDomainError(403));
    } catch (error) {
      if (error instanceof HttpException)
        return err(previewAuthorizationDomainError(error.getStatus()));
      throw error;
    }
  }

  private async authorizeEditor(
    context: IExecutionContext,
    container: DependencyContainer,
    table: Table,
    operation: 'field.delete' | 'field.convert',
    input: unknown,
    command?: UpdateFieldCommand
  ): Promise<Result<void, DomainError>> {
    if (container.isRegistered(V2_OPERATION_PREVIEW_AUTHORIZATION)) {
      return container
        .resolve<IV2OperationPreviewAuthorization>(V2_OPERATION_PREVIEW_AUTHORIZATION)
        .authorize(context, { operation, input }, container);
    }
    // Community uses the same observational policy as operation-preview.
    try {
      await this.permissions.validPermissions(
        table.id().toString(),
        [operation === 'field.delete' ? 'field|delete' : 'field|update'],
        this.cls.get('accessTokenId')
      );
    } catch (error) {
      if (error instanceof HttpException)
        return err(previewAuthorizationDomainError(error.getStatus()));
      throw error;
    }
    return command
      ? authorizeFieldConversionForeignTables(
          command,
          table,
          this.permissions,
          this.cls.get('accessTokenId')
        )
      : ok(undefined);
  }

  private async authorizeForeignIds(
    context: IExecutionContext,
    container: DependencyContainer,
    tableIds: readonly string[]
  ): Promise<Result<void, DomainError>> {
    if (container.isRegistered(V2_OPERATION_PREVIEW_AUTHORIZATION)) {
      return container
        .resolve<IV2OperationPreviewAuthorization>(V2_OPERATION_PREVIEW_AUTHORIZATION)
        .authorizeForeignTables(context, tableIds);
    }
    for (const tableId of new Set(tableIds)) {
      try {
        await this.permissions.validPermissions(
          tableId,
          ['record|read'],
          this.cls.get('accessTokenId')
        );
      } catch (error) {
        const failure = previewForeignTableAuthorizationFailure(error);
        if (failure) return err(failure);
        throw error;
      }
    }
    return ok(undefined);
  }
}
