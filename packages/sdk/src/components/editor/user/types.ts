export interface ICollaborator {
  userId: string;
  userName: string;
  // Optional: share (anonymous) collaborator responses omit email.
  email?: string;
  avatar?: string | null;
}
