import type { ClsStore } from 'nestjs-cls';

export interface IClsStore extends ClsStore {
  user: {
    id: string;
  };
}
