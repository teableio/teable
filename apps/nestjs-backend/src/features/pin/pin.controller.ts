import { Body, Controller, Delete, Get, Post, Put, Query } from '@nestjs/common';
import type { IGetPinListVo } from '@teable/openapi';
import {
  AddPinRo,
  DeletePinRo,
  addPinRoSchema,
  deletePinRoSchema,
  UpdatePinOrderRo,
  updatePinOrderRoSchema,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { PinService } from './pin.service';

@Controller('api/pin')
export class PinController {
  constructor(private readonly pinService: PinService) {}

  @Post()
  async add(@Body(new ZodValidationPipe(addPinRoSchema)) query: AddPinRo) {
    return this.pinService.addPin(query);
  }

  @Delete()
  async delete(@Query(new ZodValidationPipe(deletePinRoSchema)) query: DeletePinRo) {
    return this.pinService.deletePin(query);
  }

  @Get('list')
  async getList(): Promise<IGetPinListVo> {
    return this.pinService.getList();
  }

  @Put('order')
  async updateOrder(@Body(new ZodValidationPipe(updatePinOrderRoSchema)) body: UpdatePinOrderRo) {
    return this.pinService.updateOrder(body);
  }
}
