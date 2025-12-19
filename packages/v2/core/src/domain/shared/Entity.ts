export abstract class Entity<Id> {
  protected constructor(private readonly idValue: Id) {}

  id(): Id {
    return this.idValue;
  }
}
