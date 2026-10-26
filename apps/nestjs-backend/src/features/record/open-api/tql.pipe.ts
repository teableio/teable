import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { IFilter } from '@teable/core';
import { HttpErrorCode, parseTQL } from '@teable/core';
import { CustomHttpException } from '../../../custom.exception';

@Injectable()
export class TqlPipe<
  T extends { filterByTql?: string; filter?: IFilter },
> implements PipeTransform {
  transform(value: T, _metadata: ArgumentMetadata) {
    this.transformFilterTql(value);
    return value;
  }

  private transformFilterTql(value: T): void {
    if (value.filterByTql) {
      try {
        value.filter = parseTQL(value.filterByTql);
      } catch (e) {
        const detail = (e as Error).message;
        throw new CustomHttpException(`TQL parse error, ${detail}`, HttpErrorCode.VALIDATION_ERROR);
      }
    }
  }
}
