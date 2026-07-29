import type { CollaboratorType, PrincipalType } from '@teable/openapi';
import { Events } from '../event.enum';

export class CollaboratorCreateEvent {
  public readonly name = Events.COLLABORATOR_CREATE;

  constructor(public readonly spaceId: string) {}
}

export interface ICollaboratorInvitee {
  principalId: string;
  principalType: PrincipalType;
  /** Only present for email invitations. */
  email?: string;
  /** Only present for email invitations; the mail leg sends against it. */
  invitationId?: string;
}

export class CollaboratorInvitedEvent {
  public readonly name = Events.COLLABORATOR_INVITED;

  constructor(
    public readonly resourceId: string,
    public readonly resourceType: CollaboratorType,
    public readonly createdBy: string,
    public readonly invitees: ICollaboratorInvitee[],
    // Shadow-ban is computed per request, so it must travel in the payload.
    public readonly skipSendMail?: boolean
  ) {}
}

export class CollaboratorDeleteEvent {
  public readonly name = Events.COLLABORATOR_DELETE;

  constructor(public readonly spaceId: string) {}
}

export class CollaboratorUpdateEvent {
  public readonly name = Events.COLLABORATOR_UPDATE;

  constructor(public readonly spaceId: string) {}
}
