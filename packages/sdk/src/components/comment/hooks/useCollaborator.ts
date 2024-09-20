import { useCollaborators } from './useCollaborators';

export const useCollaborator = (id: string) => {
  const collaborators = useCollaborators();
  return collaborators.find((collaborator) => collaborator.userId === id);
};
