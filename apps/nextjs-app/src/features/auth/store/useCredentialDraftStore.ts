import { create } from 'zustand';

interface ICredentialDraftState {
  email: string;
  password: string;
  setEmail: (email: string) => void;
  setPassword: (password: string) => void;
  clear: () => void;
}

/**
 * Draft of the sign-in / sign-up credential fields. Switching between
 * /auth/login and /auth/signup remounts the page, so the draft lives in this
 * store rather than in component state. Memory only: a full reload clears it,
 * nothing persists it, and it is dropped once a submission succeeds.
 */
export const useCredentialDraftStore = create<ICredentialDraftState>()((set) => ({
  email: '',
  password: '',
  setEmail: (email) => set({ email }),
  setPassword: (password) => set({ password }),
  clear: () => set({ email: '', password: '' }),
}));
