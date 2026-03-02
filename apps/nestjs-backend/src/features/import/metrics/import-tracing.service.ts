import { Injectable } from '@nestjs/common';
import { BaseTracingService } from '../../../tracing/base-tracing.service';

@Injectable()
export class ImportTracingService extends BaseTracingService {
  setImportAttributes(attrs: { rows: number }): void {
    this.withActiveSpan((span) => {
      span.setAttribute('data.import.rows', attrs.rows);
    });
  }
}
