import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { CreateViewRo } from '../model/create-view.ro';
import { createViewInstanceByRo } from '../model/factory';

@Injectable()
export class ViewPipe implements PipeTransform {
  transform(value: CreateViewRo, _metadata: ArgumentMetadata) {
    return createViewInstanceByRo(value);
  }
}
