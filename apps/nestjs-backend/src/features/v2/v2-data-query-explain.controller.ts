import { Body, Controller, ForbiddenException, Post, Req, Res, UseFilters } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { ExplainDataQueryResponseDto } from '@teable/v2-contract-http';
import type { Request, Response } from 'express';
import { TokenAccess } from '../auth/decorators/token.decorator';
import { getBaseShareHeader, getShareViewHeader, getTemplateHeader } from '../auth/utils';
import { V2DataQueryExceptionFilter } from './v2-data-query-http';
import { V2DataQueryExplainService } from './v2-data-query-explain.service';

/**
 * Mounted by V2DataQueryExplainModule under the execute gate. Kept in its own
 * controller so execute/validate wiring stays untouched.
 */
@ApiExcludeController()
@Controller('api/v2/queries')
@UseFilters(V2DataQueryExceptionFilter)
export class V2DataQueryExplainController {
  constructor(private readonly explainer: V2DataQueryExplainService) {}

  @Post('explain')
  @TokenAccess()
  async explain(
    @Body() request: unknown,
    @Req() httpRequest: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<ExplainDataQueryResponseDto> {
    // No anonymous/share mode: a share ceiling is never user authority.
    if (
      getBaseShareHeader(httpRequest) ||
      getShareViewHeader(httpRequest) ||
      getTemplateHeader(httpRequest)
    ) {
      throw new ForbiddenException();
    }
    const result = await this.explainer.explain(request);
    response.status(result.status);
    return result.body;
  }
}
