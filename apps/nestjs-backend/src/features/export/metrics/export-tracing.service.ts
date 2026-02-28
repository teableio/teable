import { Injectable } from '@nestjs/common';
import { BaseTracingService } from '../../../tracing/base-tracing.service';

@Injectable()
export class ExportTracingService extends BaseTracingService {
  setExportAttributes(attrs: { rows: number }): void {
    this.withActiveSpan((span) => {
      span.setAttribute('data.export.rows', attrs.rows);
    });
  }
}
