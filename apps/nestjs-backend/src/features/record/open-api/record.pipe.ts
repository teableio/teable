import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { IRecordsRo } from '@teable-group/core';
import { parseTQL } from '@teable-group/core';

@Injectable()
export class RecordPipe implements PipeTransform {
  transform(value: IRecordsRo, _metadata: ArgumentMetadata) {
    this.transformFilterTql(value);
    return value;
  }

  private transformFilterTql(value: IRecordsRo): void {
    if (value.filterByTql) {
      try {
        value.filter = parseTQL(value.filterByTql);
      } catch (e) {
        throw new BadRequestException(`TQL parse error, ${(e as Error).message}`);
      }
    }
  }
}
