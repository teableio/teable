import { Body, Controller, ForbiddenException, Post, Req, Res, UseFilters } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type {
  ExecuteDataQueryResponseDto,
  ValidateDataQueryResponseDto,
} from '@teable/v2-contract-http';
import type { Request, Response } from 'express';
import { TokenAccess } from '../auth/decorators/token.decorator';
import { getBaseShareHeader, getShareViewHeader, getTemplateHeader } from '../auth/utils';
import { V2DataQueryExceptionFilter } from './v2-data-query-http';
import { V2DataQueryService } from './v2-data-query.service';

@ApiExcludeController()
@Controller('api/v2/queries')
@UseFilters(V2DataQueryExceptionFilter)
export class V2DataQueryController {
  constructor(private readonly dataQueries: V2DataQueryService) {}

  @Post('validate')
  @TokenAccess()
  async validate(
    @Body() request: unknown,
    @Req() httpRequest: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<ValidateDataQueryResponseDto> {
    if (
      getBaseShareHeader(httpRequest) ||
      getShareViewHeader(httpRequest) ||
      getTemplateHeader(httpRequest)
    ) {
      throw new ForbiddenException();
    }
    const result = await this.dataQueries.validate(request);
    response.status(result.status);
    return result.body;
  }

  @Post('execute')
  @TokenAccess()
  async execute(
    @Body() request: unknown,
    @Req() httpRequest: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<ExecuteDataQueryResponseDto> {
    // This route has no anonymous/share-link mode. Do not turn a share ceiling into user authority.
    if (
      getBaseShareHeader(httpRequest) ||
      getShareViewHeader(httpRequest) ||
      getTemplateHeader(httpRequest)
    ) {
      throw new ForbiddenException();
    }
    const result = await this.dataQueries.execute(request);
    response.status(result.status);
    return result.body;
  }
}
