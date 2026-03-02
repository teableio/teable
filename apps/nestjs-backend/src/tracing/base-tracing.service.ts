import { Logger } from '@nestjs/common';
import type { Span } from '@opentelemetry/api';
import { trace } from '@opentelemetry/api';

export abstract class BaseTracingService {
  protected readonly logger = new Logger(this.constructor.name);

  protected withActiveSpan(fn: (span: Span) => void): void {
    try {
      const span = trace.getActiveSpan();
      if (!span) return;
      fn(span);
    } catch (e) {
      this.logger.warn(`Tracing failed: ${e}`);
    }
  }
}
