import { Role } from '@teable/core';
import type { UniqueCollaboratorItem } from '@teable/openapi';
import { CollaboratorType, PrincipalType } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import {
  emailKey,
  isInviteEmailValid,
  uniqueCollaboratorToSpaceItem,
  withInviteEmail,
} from './utils';

const uniqueUser: UniqueCollaboratorItem = {
  type: PrincipalType.User,
  userId: 'usr1',
  userName: 'Alice',
  email: 'alice@example.com',
  avatar: 'https://example.com/a.png',
  isSystem: undefined,
  lastSignTime: '2026-07-22T00:00:00.000Z',
  spaceRole: Role.Creator,
  baseCount: 2,
  createdTime: '2026-07-20T00:00:00.000Z',
  billable: true,
};

describe('uniqueCollaboratorToSpaceItem', () => {
  it('maps a space member to its space-level row', () => {
    expect(uniqueCollaboratorToSpaceItem(uniqueUser)).toEqual({
      type: PrincipalType.User,
      resourceType: CollaboratorType.Space,
      userId: 'usr1',
      userName: 'Alice',
      email: 'alice@example.com',
      avatar: 'https://example.com/a.png',
      isSystem: undefined,
      billable: true,
      role: Role.Creator,
      createdTime: '2026-07-20T00:00:00.000Z',
      lastSignTime: '2026-07-22T00:00:00.000Z',
    });
  });

  it('falls back to Viewer for a base-only principal', () => {
    const item = uniqueCollaboratorToSpaceItem({ ...uniqueUser, spaceRole: null });
    expect(item.role).toBe(Role.Viewer);
  });

  it('maps a department principal', () => {
    expect(
      uniqueCollaboratorToSpaceItem({
        type: PrincipalType.Department,
        departmentId: 'dpt1',
        departmentName: 'Design',
        spaceRole: Role.Editor,
        baseCount: 0,
        createdTime: '2026-07-20T00:00:00.000Z',
      })
    ).toEqual({
      type: PrincipalType.Department,
      resourceType: CollaboratorType.Space,
      departmentId: 'dpt1',
      departmentName: 'Design',
      role: Role.Editor,
      createdTime: '2026-07-20T00:00:00.000Z',
    });
  });
});

/**
 * The invitation API lowercases the batch but never dedupes it, so a batch
 * carrying one mailbox twice fails outright (500) whenever that address has no
 * account yet. These rules are what keeps such a batch from being built.
 */
describe('invite email normalisation', () => {
  it('treats case and surrounding space as the same mailbox', () => {
    expect(emailKey('  M17799501712@163.com ')).toBe(emailKey('m17799501712@163.com'));
  });

  it('keeps one entry for two spellings of one address', () => {
    const first = withInviteEmail([], 'm17799501712@163.com');
    expect(withInviteEmail(first, 'M17799501712@163.com')).toEqual(['m17799501712@163.com']);
  });

  it('keeps the address as the user typed it', () => {
    expect(withInviteEmail([], '  Alice@Example.com ')).toEqual(['Alice@Example.com']);
  });

  it('still appends a genuinely different address', () => {
    expect(withInviteEmail(['a@b.co'], 'c@d.co')).toEqual(['a@b.co', 'c@d.co']);
  });

  it('accepts an address padded with spaces', () => {
    expect(isInviteEmailValid('  a@b.co ')).toBe(true);
    expect(isInviteEmailValid('invalid')).toBe(false);
  });
});
