import { useMutation, useQuery } from '@tanstack/react-query';
import type { HttpError } from '@teable/core';
import { Role } from '@teable/core';
import type { IDeleteUserBlockingSpace, PrincipalType } from '@teable/openapi';
import {
  deleteUser,
  deleteUserErrorDataSchema,
  getDeleteUserSpaces,
  updateSpaceCollaborator,
} from '@teable/openapi';
import { useCallback, useState } from 'react';
import type { ISpaceTransfers } from './SoleOwnerSpaceList';

/** The word the server wants typed out before it will delete an account. */
export const DELETE_CONFIRMATION = 'DELETE';

/**
 * The spaces named by a refusal, if that is what the refusal was about.
 *
 * Read from the body rather than from the error code: the code is the server's idea of the
 * category ("validation"), and pinning the branch to it means any future change of category
 * turns a list the reader could act on back into a sentence they cannot. A body carrying
 * spaces is unambiguous on its own.
 */
function blockingSpaces(error: HttpError): IDeleteUserBlockingSpace[] | undefined {
  const parsed = deleteUserErrorDataSchema.safeParse(error.data);
  return parsed.success ? parsed.data.spaces : undefined;
}

/** Just enough of a collaborator to hand a space to them. */
export interface ISpaceMemberRef {
  principalId: string;
  principalType: PrincipalType;
}

/** What the next attempt does with each space the server named. */
export interface IDeletionPlan {
  /** Sole-owned spaces the reader let go: trashed together with the account. */
  toTrash: string[];
  /** Spaces handed to another member first, so they outlive the account. */
  handOvers: { spaceId: string; member: ISpaceMemberRef }[];
  /** A subscribed space nobody is taking: nothing on this page can settle it. */
  blocked: boolean;
}

/**
 * A space with a chosen member is handed over; one without goes to trash — unless it has a
 * live subscription, which only a hand-over or a cancellation elsewhere can settle, and
 * which holds the whole deletion until it is.
 */
export function planAccountDeletion(
  spaces: readonly IDeleteUserBlockingSpace[],
  // Only the two fields a hand-over needs: the picker's fuller member is assignable to this,
  // and the rule reads the same whether or not a name and a role came along with it.
  transfers: Readonly<Record<string, ISpaceMemberRef | undefined>>
): IDeletionPlan {
  const plan: IDeletionPlan = { toTrash: [], handOvers: [], blocked: false };
  for (const space of spaces) {
    const member = transfers[space.id];
    if (member) plan.handOvers.push({ spaceId: space.id, member });
    else if (space.subscribed) plan.blocked = true;
    else plan.toTrash.push(space.id);
  }
  return plan;
}

export interface IDeleteAccountFlow {
  confirmText: string;
  setConfirmText: (text: string) => void;
  /** A refusal that named no spaces: nothing to act on, so it is said in words. */
  message?: string;
  /** The sole-owned spaces are still being looked up; the list below is not yet the list. */
  isLoadingSpaces: boolean;
  spaces: IDeleteUserBlockingSpace[];
  /** A subscribed space nobody is taking holds the deletion until it is settled. */
  blocked: boolean;
  transfers: ISpaceTransfers;
  setTransfers: (transfers: ISpaceTransfers) => void;
  isPending: boolean;
  /** False while the confirmation is unwritten, or a subscribed space has nobody to go to. */
  canSubmit: boolean;
  submit: () => void;
  reset: () => void;
}

/**
 * Leaving for good. The spaces this account is the only owner of are read first and shown
 * before anything is pressed: each is handed to another member or let go to trash with the
 * account, and the one press that follows does all of it. A space with a live subscription
 * is the one thing that cannot be settled here; it holds the deletion until it is handed
 * over or its subscription is cancelled. Should the server still refuse — a space that
 * appeared since the list was read — its answer replaces the list and the reader presses
 * once more.
 *
 * The state lives here rather than in either surface, because there are two — a dialog on a
 * desktop settings page, and a page of its own that the phone app opens — and a flow this
 * particular is not worth having twice.
 */
export function useDeleteAccount({ onDeleted }: { onDeleted: () => void }): IDeleteAccountFlow {
  const [confirmText, setConfirmText] = useState('');
  const [message, setMessage] = useState<string>();
  // Named by a refusal: the server's list wins over the one read at the start.
  const [refused, setRefused] = useState<IDeleteUserBlockingSpace[]>();
  const [transfers, setTransfers] = useState<ISpaceTransfers>({});
  // Read once per visit. The question is what this account leaves behind now; a list that
  // went stale while the reader was typing is corrected by the refusal, in front of them,
  // not by a refetch behind their back.
  const listing = useQuery({
    queryKey: ['auth', 'delete-account', 'sole-owner-spaces'],
    queryFn: () => getDeleteUserSpaces().then(({ data }) => data.spaces),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  // On the attempt each space is handed over to the chosen member, or trashed together with
  // the account when nobody was chosen.
  const spaces = refused ?? listing.data ?? [];

  // A subscribed space only blocks while nobody takes it over: handed over, it keeps its
  // subscription under the new owner.
  const plan = planAccountDeletion(spaces, transfers);

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      // Hand-overs first: a space that changes owner is no longer sole-owned, so the delete
      // that follows has nothing left to refuse over.
      for (const { spaceId, member } of plan.handOvers) {
        await updateSpaceCollaborator({
          spaceId,
          updateSpaceCollaborateRo: {
            principalId: member.principalId,
            principalType: member.principalType,
            role: Role.Owner,
          },
        });
      }
      return deleteUser(confirmText, plan.toTrash);
    },
    meta: { preventGlobalError: true },
    onError: (error: HttpError) => {
      const named = blockingSpaces(error);
      if (named) {
        setMessage(undefined);
        setRefused(named);
        setTransfers({});
      } else {
        setMessage(error.message);
      }
    },
    onSuccess: onDeleted,
  });

  // Stable across renders: the dialog runs this from an effect keyed on it, and a fresh
  // function every render would fire that effect on every keystroke, wiping the confirmation.
  const { refetch } = listing;
  const reset = useCallback(() => {
    setConfirmText('');
    setMessage(undefined);
    setRefused(undefined);
    setTransfers({});
    void refetch();
  }, [refetch]);

  return {
    confirmText,
    setConfirmText,
    message,
    isLoadingSpaces: listing.isPending,
    spaces,
    blocked: plan.blocked,
    transfers,
    setTransfers,
    isPending,
    canSubmit:
      confirmText === DELETE_CONFIRMATION && !listing.isPending && !plan.blocked && !isPending,
    submit: mutate,
    reset,
  };
}
