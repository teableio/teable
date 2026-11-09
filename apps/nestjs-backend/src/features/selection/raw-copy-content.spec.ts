import { FieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';

import { buildRawCopyContent } from './raw-copy-content';

describe('authorized raw clipboard projection', () => {
  it('retains user identity pairs, cardinality and empty values without internal properties', () => {
    const member = {
      id: 'usrCopyMember',
      title: 'Copy Member',
      email: 'copy-member@example.invalid',
      avatarUrl: 'private-avatar',
      internal: 'private-metadata',
    };
    const rows = [{ fields: { single: member, multi: [member], empty: null, text: 'kept' } }];
    expect(
      buildRawCopyContent(
        rows,
        [
          { id: 'single', type: FieldType.User },
          { id: 'multi', type: FieldType.User },
          { id: 'empty', type: FieldType.User },
          { id: 'text', type: FieldType.SingleLineText },
        ],
        [['Copy Member', 'Copy Member', '', 'kept']]
      )
    ).toEqual([
      [
        { id: member.id, title: member.title, email: member.email },
        [{ id: member.id, title: member.title, email: member.email }],
        null,
        'kept',
      ],
    ]);
  });

  it('never enriches missing email or raw lookup values', () => {
    expect(
      buildRawCopyContent(
        [{ fields: { user: { id: 'usrWithoutEmail', title: 'No Email' }, lookup: { id: 'usrHidden', email: 'hidden@example.invalid' } } }],
        [
          { id: 'user', type: FieldType.User },
          { id: 'lookup', type: FieldType.User, isLookup: true },
        ],
        [['No Email', 'Visible label']]
      )
    ).toEqual([[{ id: 'usrWithoutEmail', title: 'No Email' }, 'Visible label']]);
  });

  it('preserves array positions and rejects malformed user identities', () => {
    const fields = [{ id: 'user', type: FieldType.User }];
    const member = { id: 'usrA', title: 'A' };
    expect(buildRawCopyContent([{ fields: { user: [member, null, member] } }], fields, [['A, A']]))
      .toEqual([[[member, null, member]]]);
    expect(() =>
      buildRawCopyContent([{ fields: { user: [member, { title: 'unknown' }] } }], fields, [['A']])
    ).toThrow('Invalid user cell in copy source');
  });

  it('does not allocate a second content matrix for selections without direct user columns', () => {
    expect(
      buildRawCopyContent(
        [{ fields: { text: 'kept' } }],
        [{ id: 'text', type: FieldType.SingleLineText }],
        [['kept']]
      )
    ).toBeUndefined();
  });
});
