import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { IFilter } from '@teable/core';
import { parseTQL } from '@teable/core';

@Injectable()
export class TqlPipe<T extends { filterByTql?: string; filter?: IFilter }>
  implements PipeTransform
{
  transform(value: T, _metadata: ArgumentMetadata) {
    this.transformFilterTql(value);
    return value;
  }

  private transformFilterTql(value: T): void {
    if (value.filterByTql) {
      try {
        value.filter = parseTQL(value.filterByTql);
      } catch (e) {
        throw new BadRequestException(`TQL parse error, ${(e as Error).message}`);
      }
    }
  }
}
