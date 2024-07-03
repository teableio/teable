/* eslint-disable @typescript-eslint/naming-convention */
import { Event } from './event.enum';

export type WebhookEventPayload = Extract<
  Event,
  | Event.BASE_CREATE
  | Event.BASE_DELETE
  | Event.BASE_UPDATE
  | Event.TABLE_CREATE
  | Event.TABLE_DELETE
  | Event.TABLE_UPDATE
  | Event.TABLE_FIELD_CREATE
  | Event.TABLE_FIELD_DELETE
  | Event.TABLE_FIELD_UPDATE
  | Event.TABLE_RECORD_CREATE
  | Event.TABLE_RECORD_DELETE
  | Event.TABLE_RECORD_UPDATE
  | Event.TABLE_VIEW_CREATE
  | Event.TABLE_VIEW_DELETE
  | Event.TABLE_VIEW_UPDATE
>;

export const EventsByWebhook: WebhookEventPayload[] = [
  Event.BASE_CREATE,
  Event.BASE_DELETE,
  Event.BASE_UPDATE,

  Event.TABLE_CREATE,
  Event.TABLE_DELETE,
  Event.TABLE_UPDATE,
  Event.TABLE_FIELD_CREATE,
  Event.TABLE_FIELD_DELETE,
  Event.TABLE_FIELD_UPDATE,
  Event.TABLE_RECORD_CREATE,
  Event.TABLE_RECORD_DELETE,
  Event.TABLE_RECORD_UPDATE,
  Event.TABLE_VIEW_CREATE,
  Event.TABLE_VIEW_DELETE,
  Event.TABLE_VIEW_UPDATE,
];
