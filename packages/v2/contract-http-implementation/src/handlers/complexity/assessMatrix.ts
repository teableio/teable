import type {
  ComplexityMatrixResult,
  ComplexityMatrixRow,
  IComplexityService,
} from '@teable/v2-command-explain';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IComplexityAssessMatrixInputDto,
  type IComplexityAssessMatrixOkResponseDto,
  type IComplexityAssessMatrixResultDto,
  type IComplexityMatrixRowDto,
} from '@teable/v2-contract-http';
import type { IExecutionContext } from '@teable/v2-core';

/**
 * HTTP adapter for the field-by-operation matrix. Metadata is loaded once by
 * IComplexityService; this layer only maps domain errors to the API.
 */
export type IComplexityMatrixEndpointResult =
  | { readonly status: 200; readonly body: IComplexityAssessMatrixOkResponseDto }
  | { readonly status: HttpErrorStatus; readonly body: IApiErrorResponseDto };

const toRowDto = (row: ComplexityMatrixRow): IComplexityMatrixRowDto => ({
  scope: row.scope,
  fieldId: row.fieldId,
  fieldType: row.fieldType,
  tableId: row.tableId,
  level: row.level,
  typicalRows: row.typicalRows,
  worstRows: row.worstRows,
  mainReason: row.mainReason,
  confidence: row.confidence,
  basis: row.basis,
  unknownCellCount: row.unknownCellCount,
  cells: row.cells.map((cell) => ({
    operation: cell.operation,
    basis: cell.basis,
    level: cell.level,
    score: cell.score,
    confidence: cell.confidence,
    workload: {
      status: cell.workload.status,
      rows: {
        status: cell.workload.rows.status,
        expected: cell.workload.rows.expected,
        lower: cell.workload.rows.lower,
        upper: cell.workload.rows.upper,
      },
      typicalLevel: cell.workload.typicalLevel,
      worstCaseLevel: cell.workload.worstCaseLevel,
      level: cell.workload.level,
      basis: cell.workload.basis,
      warnings: [...cell.workload.warnings],
    },
    structural: cell.structural,
    dataWork: cell.dataWork,
    risk: cell.risk,
    reasonCodes: [...cell.reasonCodes],
    warnings: [...cell.warnings],
  })),
});

const toResponseDto = (value: ComplexityMatrixResult): IComplexityAssessMatrixResultDto => ({
  tableId: value.tableId,
  completeness: value.completeness,
  fieldCount: value.fieldCount,
  basis: value.basis,
  rows: value.rows.map(toRowDto),
  unknownRows: value.unknownRows.map(toRowDto),
  warnings: [...value.warnings],
});

export const executeComplexityAssessMatrixEndpoint = async (
  context: IExecutionContext,
  input: IComplexityAssessMatrixInputDto,
  service: IComplexityService
): Promise<IComplexityMatrixEndpointResult> => {
  const result = await service.assessMatrix(context, input);

  if (result.isErr()) {
    const error = result.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  return { status: 200, body: { ok: true, data: toResponseDto(result.value) } };
};
