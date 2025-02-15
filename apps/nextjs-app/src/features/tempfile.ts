// TODO Remove this file and move its content to @teable/core

// import type { WebhookEventPayload } from '@teable/core';
// import { Event, EventsByWebhook } from '@teable/core';

import { Events } from '../../../nestjs-backend/src/event-emitter/events'; // i know, i know... this is a bad practice, but i'm just trying to make it work

export { Events };

export type WebhookEventPayload = Extract<
  Events,
  | Events.BASE_CREATE
  | Events.BASE_DELETE
  | Events.BASE_UPDATE
  | Events.TABLE_CREATE
  | Events.TABLE_DELETE
  | Events.TABLE_UPDATE
  | Events.TABLE_FIELD_CREATE
  | Events.TABLE_FIELD_DELETE
  | Events.TABLE_FIELD_UPDATE
  | Events.TABLE_RECORD_CREATE
  | Events.TABLE_RECORD_DELETE
  | Events.TABLE_RECORD_UPDATE
  | Events.TABLE_VIEW_CREATE
  | Events.TABLE_VIEW_DELETE
  | Events.TABLE_VIEW_UPDATE
>;

export const EventsByWebhook: WebhookEventPayload[] = [
  Events.BASE_CREATE,
  Events.BASE_DELETE,
  Events.BASE_UPDATE,

  Events.TABLE_CREATE,
  Events.TABLE_DELETE,
  Events.TABLE_UPDATE,
  Events.TABLE_FIELD_CREATE,
  Events.TABLE_FIELD_DELETE,
  Events.TABLE_FIELD_UPDATE,
  Events.TABLE_RECORD_CREATE,
  Events.TABLE_RECORD_DELETE,
  Events.TABLE_RECORD_UPDATE,
  Events.TABLE_VIEW_CREATE,
  Events.TABLE_VIEW_DELETE,
  Events.TABLE_VIEW_UPDATE,
];

export const defaultEvents: WebhookEventPayload[] = [
  Events.TABLE_RECORD_CREATE,
  Events.TABLE_RECORD_DELETE,
  Events.TABLE_RECORD_UPDATE,
];
