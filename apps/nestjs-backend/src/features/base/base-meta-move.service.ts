export const BASE_META_MOVE_SERVICE = Symbol('BASE_META_MOVE_SERVICE');

export interface IBaseMetaMoveService {
  applyMetaMoveBase(baseId: string, targetSpaceId: string): Promise<void>;
}
