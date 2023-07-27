import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { IGetRecordsQuery } from '@teable-group/core';
import { parseTQL } from '@teable-group/core';

@Injectable()
export class RecordPipe implements PipeTransform {
  transform(value: IGetRecordsQuery, _metadata: ArgumentMetadata) {
    this.transformFilterTql(value);
    return value;
  }

  private transformFilterTql(value: IGetRecordsQuery): void {
    if (value.filterByTql) {
      try {
        value.filter = parseTQL(value.filterByTql);
      } catch (e) {
        throw new BadRequestException(`TQL parse error, ${(e as Error).message}`);
      }
    }
  }
}
