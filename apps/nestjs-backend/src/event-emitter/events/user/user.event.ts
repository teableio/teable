import { Events } from '../event.enum';

export class UserSignUpEvent {
  public readonly name = Events.USER_SIGNUP;

  constructor(public readonly userId: string) {}
}
