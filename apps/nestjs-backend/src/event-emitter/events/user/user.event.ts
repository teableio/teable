import { Events } from '../event.enum';

export class UserSignUpEvent {
  public readonly name = Events.USER_SIGNUP;

  constructor(public readonly userId: string) {}
}

export class UserEmailChangeEvent {
  public readonly name = Events.USER_EMAIL_CHANGE;

  constructor(
    public readonly userId: string,
    public readonly oldEmail: string,
    public readonly newEmail: string
  ) {}
}
