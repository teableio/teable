import { create } from 'zustand';

export interface IUser {
  id: string;
  name: string;
  description: string;
  avatar: string;
}

const localUser: IUser = {
  id: 'local-user',
  name: 'Local user',
  description: '',
  avatar: '',
};

interface IUserState {
  currentUser: IUser;
}

export const useUserStore = create<IUserState>()(() => ({
  currentUser: localUser,
}));
