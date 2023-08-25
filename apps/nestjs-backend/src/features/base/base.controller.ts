import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { responseWrap } from '../../utils/api-response';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { ISqlQuerySchemaRo, sqlQuerySchemaRo } from './base.schema';
import { BaseService } from './base.service';

@ApiTags('base')
@Controller('api/base')
export class BaseController {
  constructor(private readonly baseService: BaseService) {}

  @Post('sqlQuery')
  async sqlQuery(@Body(new ZodValidationPipe(sqlQuerySchemaRo)) param: ISqlQuerySchemaRo) {
    const snapshot = await this.baseService.sqlQuery(param.tableId, param.viewId, param.sql);
    return responseWrap(snapshot);
  }
}
