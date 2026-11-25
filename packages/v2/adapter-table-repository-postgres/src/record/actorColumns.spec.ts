import { describe, expect, it } from 'vitest';
import { readRecordActors, readStoredActor } from './actorColumns';

describe('stored actor decoding', () => {
  it.each(['user', 'appUser', 'automation', 'system'])('preserves a known %s reference', (type) => {
    expect(readStoredActor(type, 'principal')).toEqual({ type, id: 'principal' });
  });

  it.each([
    ['future-kind', 'principal'],
    ['', 'principal'],
    ['user', ''],
    ['user', null],
    [null, 'principal'],
    [null, null],
  ])(
    'keeps unsupported or incomplete %s/%s pairs unknown without executor fallback',
    (type, id) => {
      expect(
        readRecordActors({
          __created_by: 'executor',
          __last_modified_by: 'executor',
          __created_by_actor_type: type,
          __created_by_actor_id: id,
          __last_modified_by_actor_type: type,
          __last_modified_by_actor_id: id,
        })
      ).toEqual({
        createdByActorType: null,
        createdByActorId: null,
        lastModifiedByActorType: null,
        lastModifiedByActorId: null,
      });
    }
  );
});
