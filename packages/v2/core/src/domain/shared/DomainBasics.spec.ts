import { describe, expect, it } from 'vitest';

import { ActorId } from './ActorId';
import { AggregateRoot } from './AggregateRoot';
import type { IDomainEvent } from './DomainEvent';
import { DomainEventName } from './DomainEventName';
import { OccurredAt } from './OccurredAt';
import { RehydratedValueObject } from './RehydratedValueObject';
import { ValueObject } from './ValueObject';

class TestValueObject extends ValueObject {
  constructor(private readonly value: string) {
    super();
  }

  equals(other: TestValueObject): boolean {
    return this.value === other.value;
  }
}

class TestRehydratedValue extends RehydratedValueObject {
  private constructor(value?: string) {
    super(value);
  }

  static empty(): TestRehydratedValue {
    return new TestRehydratedValue();
  }

  static rehydrate(raw: string): TestRehydratedValue {
    return new TestRehydratedValue(raw);
  }

  value() {
    return this.valueResult('TestRehydratedValue');
  }
}

class TestAggregate extends AggregateRoot<ActorId> {
  constructor(id: ActorId) {
    super(id);
  }

  record(event: IDomainEvent): void {
    this.addDomainEvent(event);
  }
}

describe('ActorId', () => {
  it('creates valid ids and rejects invalid values', () => {
    const okResult = ActorId.create('system');
    okResult._unsafeUnwrap();

    expect(okResult._unsafeUnwrap().toString()).toBe('system');

    const badResult = ActorId.create('');
    badResult._unsafeUnwrapErr();
  });

  it('compares ids by value', () => {
    const leftResult = ActorId.create('a');
    const rightResult = ActorId.create('a');
    const otherResult = ActorId.create('b');
    [leftResult, rightResult, otherResult].forEach((result) => result._unsafeUnwrap());
    leftResult._unsafeUnwrap();
    rightResult._unsafeUnwrap();
    otherResult._unsafeUnwrap();
    expect(leftResult._unsafeUnwrap().equals(rightResult._unsafeUnwrap())).toBe(true);
    expect(leftResult._unsafeUnwrap().equals(otherResult._unsafeUnwrap())).toBe(false);
  });
});

describe('DomainEventName', () => {
  it('creates event names and handles tableCreated', () => {
    const result = DomainEventName.create('CustomEvent');
    const eventName = result._unsafeUnwrap();
    expect(eventName.toString()).toBe('CustomEvent');
    expect(DomainEventName.tableCreated().toString()).toBe('TableCreated');
  });

  it('rejects invalid event names', () => {
    DomainEventName.create('')._unsafeUnwrapErr();
  });
});

describe('OccurredAt', () => {
  it('creates instances from dates and compares by time', () => {
    const now = new Date('2024-01-01T00:00:00.000Z');
    const result = OccurredAt.create(now);
    const occurredAt = result._unsafeUnwrap();

    const sameTime = OccurredAt.create(new Date('2024-01-01T00:00:00.000Z'));
    const sameOccurredAt = sameTime._unsafeUnwrap();

    expect(occurredAt.equals(sameOccurredAt)).toBe(true);
    expect(occurredAt.toDate().toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('rejects invalid inputs', () => {
    OccurredAt.create('now')._unsafeUnwrapErr();
  });
});

describe('ValueObject', () => {
  it('supports custom equality', () => {
    const left = new TestValueObject('a');
    const right = new TestValueObject('a');
    const other = new TestValueObject('b');
    expect(left.equals(right)).toBe(true);
    expect(left.equals(other)).toBe(false);
  });
});

describe('RehydratedValueObject', () => {
  it('requires rehydrate before accessing value', () => {
    const empty = TestRehydratedValue.empty();
    expect(empty.isRehydrated()).toBe(false);
    const valueResult = empty.value();
    valueResult._unsafeUnwrapErr();
  });

  it('returns value after rehydrate and compares by raw value', () => {
    const left = TestRehydratedValue.rehydrate('name');
    const right = TestRehydratedValue.rehydrate('name');
    const other = TestRehydratedValue.rehydrate('other');
    expect(left.isRehydrated()).toBe(true);
    left.value()._unsafeUnwrap();
    expect(left.equals(right)).toBe(true);
    expect(left.equals(other)).toBe(false);
  });
});

describe('AggregateRoot', () => {
  it('collects and clears domain events', () => {
    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const aggregate = new TestAggregate(actorIdResult._unsafeUnwrap());
    const event = {
      name: DomainEventName.tableCreated(),
      occurredAt: OccurredAt.now(),
    };
    aggregate.record(event);
    const events = aggregate.pullDomainEvents();
    expect(events).toEqual([event]);
    expect(aggregate.pullDomainEvents()).toEqual([]);
  });
});
