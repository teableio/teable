import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { parseTQL } from '@teable-group/core/dist/query/json.visitor';
import type { RecordsRo } from 'src/features/record/open-api/records.ro';
import { TError } from '../../../utils/catch-error';

@Injectable()
export class RecordPipe implements PipeTransform {
  transform(value: RecordsRo, _metadata: ArgumentMetadata) {
    this.transformFilterTql(value);
    return value;
  }

  private transformFilterTql(value: RecordsRo): void {
    if (value.filterByTql) {
      try {
        value.filter = parseTQL(value.filterByTql);
      } catch (e) {
        TError.badRequest(`TQL parse error, ${(e as Error).message}`);
      }
    }
  }
}
