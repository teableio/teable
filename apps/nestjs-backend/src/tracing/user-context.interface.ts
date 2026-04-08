export const USER_CONTEXT_SERVICE = 'USER_CONTEXT_SERVICE';

export interface IUserContextService {
  getPlanLevel(spaceId: string): Promise<string>;
}
