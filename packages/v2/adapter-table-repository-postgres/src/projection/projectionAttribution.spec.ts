import { describe, expect, it } from 'vitest';
import { restoreProjectionAttribution } from './projectionAttribution';

const envelope = {
  version: 1,
  eventId: 'event-1',
  operationId: 'operation-1',
  occurredAt: '2026-10-01T01:02:03.456Z',
  context: {
    actorId: 'appRobot',
    initiator: { type: 'appUser', id: 'apu_stable' },
    requestId: 'original-request',
    operationAttribution: {
      operationId: 'operation-1',
      occurredAt: '2026-10-01T01:02:00.000Z',
      action: 'create',
      source: 'api',
    },
  },
};

describe('restoreProjectionAttribution', () => {
  it('restores only the frozen producer identity and mutation time', () => {
    expect(restoreProjectionAttribution(envelope, 'event-1')._unsafeUnwrap()).toEqual({
      actorId: 'appRobot',
      initiator: { type: 'appUser', id: 'apu_stable' },
      requestId: 'original-request',
      operationId: 'operation-1',
      occurredAt: new Date(envelope.occurredAt),
      operationAttribution: envelope.context.operationAttribution,
    });
  });
  it('keeps historical messages unknown instead of assigning the worker identity or clock', () => {
    expect(restoreProjectionAttribution(null, 'old-event')._unsafeUnwrap()).toEqual({
      actorId: 'unknown',
      occurredAt: null,
    });
  });
  it.each([
    { ...envelope, version: 2 },
    { ...envelope, eventId: 'different' },
    { ...envelope, occurredAt: 'invalid' },
    { ...envelope, context: { actorId: 'appRobot', initiator: { type: 'appUser' } } },
    {
      ...envelope,
      context: { actorId: 'appRobot', initiator: { type: 'future', id: 'future-1' } },
    },
  ])('fails closed for unsupported or malformed persisted envelopes', (value) => {
    expect(restoreProjectionAttribution(value, 'event-1')._unsafeUnwrapErr().code).toBe(
      'domain_event.attribution_invalid'
    );
  });
});
