import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { IViewRo } from '@teable-group/core';
import { createViewInstanceByRo } from '../model/factory';

@Injectable()
export class ViewPipe implements PipeTransform {
  transform(value: IViewRo, _metadata: ArgumentMetadata) {
    return createViewInstanceByRo(value);
  }
}
