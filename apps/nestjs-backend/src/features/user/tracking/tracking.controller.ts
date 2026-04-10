import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { ITrackEventRo, trackEventRoSchema } from '@teable/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';

// Allowed frontend events (whitelist to prevent arbitrary span pollution)
// eslint-disable-next-line @typescript-eslint/naming-convention
const ALLOWED_EVENTS = new Set([
  'view.open',
  'record.expand',
  'filter.apply',
  'sort.apply',
  'search.execute',
  'app.view',
  'app.page_view',
]);

@Controller('api/user')
export class TrackingController {
  @Post('track')
  @HttpCode(HttpStatus.NO_CONTENT)
  async trackEvent(
    @Body(new ZodValidationPipe(trackEventRoSchema)) body: ITrackEventRo
  ): Promise<void> {
    if (!ALLOWED_EVENTS.has(body.event)) {
      return;
    }

    // The OTEL span for this HTTP request already carries user_id + plan from RouteTracingInterceptor.
    // We just add the event-specific attributes so SigNoz can query by event name.
    const span = trace.getActiveSpan();
    if (span) {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      span.setAttributes({ 'teable.track.event': body.event });
      if (body.properties) {
        for (const [key, value] of Object.entries(body.properties)) {
          if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            span.setAttribute(`teable.track.${key}`, value);
          }
        }
      }
    }
  }
}
