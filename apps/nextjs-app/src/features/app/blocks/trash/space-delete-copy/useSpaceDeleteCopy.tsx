import type { ReactNode } from 'react';

/**
 * What the permanent-delete confirm does before the page deletes the space itself.
 * - `delete`: go ahead.
 * - `handed-over`: the deletion is no longer the page's to do; it follows the copy.
 * - `abort`: neither — the copy was refused, the space stays where it is.
 */
export type ISpaceDeleteCopyOutcome = 'delete' | 'handed-over' | 'abort';

export interface ISpaceDeleteCopy {
  /** Rendered in the confirm dialog; null when there is nothing to choose. */
  option: ReactNode;
  beforeDelete: () => Promise<ISpaceDeleteCopyOutcome>;
  isPending: boolean;
}

export interface IUseSpaceDeleteCopyProps {
  spaceId?: string;
  /** Off while the dialog is for a force removal: a copy needs the data to be reachable. */
  available: boolean;
}

/**
 * The trash's permanent delete of a space, and what it offers first. Mapped through
 * `@overridable/useSpaceDeleteCopy` so the enterprise edition can offer a copy of the space,
 * mailed before it goes; here there is no choice and the page deletes straight away.
 */
export const useSpaceDeleteCopy = (_props: IUseSpaceDeleteCopyProps): ISpaceDeleteCopy => ({
  option: null,
  beforeDelete: async () => 'delete',
  isPending: false,
});
