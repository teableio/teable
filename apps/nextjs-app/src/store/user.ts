import { create } from 'zustand';

export interface IUser {
  id: string;
  name: string;
  description: string;
  avatar: string;
}

const defaultUser: IUser = {
  id: 'default-user',
  name: 'Default user',
  description: '',
  avatar: '',
};

interface IUserState {
  currentUser: IUser;
}

export const useUserStore = create<IUserState>()(() => ({
  currentUser: defaultUser,
}));
