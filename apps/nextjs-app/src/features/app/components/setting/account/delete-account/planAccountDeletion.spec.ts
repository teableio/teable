import { PrincipalType } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { planAccountDeletion } from './useDeleteAccount';

const space = (id: string, extra: { subscribed?: boolean } = {}) => ({
  id,
  name: id,
  hasOtherMembers: true,
  ...extra,
});
const member = (principalId: string) => ({ principalId, principalType: PrincipalType.User });

describe('planAccountDeletion', () => {
  it('trashes a space nobody was chosen for', () => {
    expect(planAccountDeletion([space('a')], {})).toEqual({
      toTrash: ['a'],
      handOvers: [],
      blocked: false,
    });
  });

  it('hands over a space with a chosen member instead of trashing it', () => {
    const plan = planAccountDeletion([space('a')], { a: member('usr1') });
    expect(plan.toTrash).toEqual([]);
    expect(plan.handOvers).toEqual([{ spaceId: 'a', member: member('usr1') }]);
    expect(plan.blocked).toBe(false);
  });

  it('is blocked by a subscribed space nobody is taking', () => {
    // Trashing it is not on offer — the subscription has to go somewhere, either to a new
    // owner or to a cancellation made somewhere this page cannot reach.
    const plan = planAccountDeletion([space('a', { subscribed: true })], {});
    expect(plan).toEqual({ toTrash: [], handOvers: [], blocked: true });
  });

  it('is not blocked once the subscribed space has someone to go to', () => {
    const plan = planAccountDeletion([space('a', { subscribed: true })], { a: member('usr1') });
    expect(plan.blocked).toBe(false);
    expect(plan.handOvers).toHaveLength(1);
  });

  it('settles each space on its own', () => {
    const plan = planAccountDeletion(
      [space('keep'), space('give'), space('paid', { subscribed: true })],
      { give: member('usr1'), paid: member('usr2') }
    );
    expect(plan.toTrash).toEqual(['keep']);
    expect(plan.handOvers.map(({ spaceId }) => spaceId)).toEqual(['give', 'paid']);
    expect(plan.blocked).toBe(false);
  });
});
