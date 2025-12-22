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
    expect(okResult.isOk()).toBe(true);
    if (okResult.isErr()) return;
    expect(okResult.value.toString()).toBe('system');

    const badResult = ActorId.create('');
    expect(badResult.isErr()).toBe(true);
  });

  it('compares ids by value', () => {
    const leftResult = ActorId.create('a');
    const rightResult = ActorId.create('a');
    const otherResult = ActorId.create('b');
    expect([leftResult, rightResult, otherResult].every((result) => result.isOk())).toBe(true);
    if (leftResult.isErr() || rightResult.isErr() || otherResult.isErr()) return;
    expect(leftResult.value.equals(rightResult.value)).toBe(true);
    expect(leftResult.value.equals(otherResult.value)).toBe(false);
  });
});

describe('DomainEventName', () => {
  it('creates event names and handles tableCreated', () => {
    const result = DomainEventName.create('CustomEvent');
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.toString()).toBe('CustomEvent');
    expect(DomainEventName.tableCreated().toString()).toBe('TableCreated');
  });

  it('rejects invalid event names', () => {
    expect(DomainEventName.create('').isErr()).toBe(true);
  });
});

describe('OccurredAt', () => {
  it('creates instances from dates and compares by time', () => {
    const now = new Date('2024-01-01T00:00:00.000Z');
    const result = OccurredAt.create(now);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const sameTime = OccurredAt.create(new Date('2024-01-01T00:00:00.000Z'));
    expect(sameTime.isOk()).toBe(true);
    if (sameTime.isErr()) return;

    expect(result.value.equals(sameTime.value)).toBe(true);
    expect(result.value.toDate().toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('rejects invalid inputs', () => {
    expect(OccurredAt.create('now').isErr()).toBe(true);
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
    expect(valueResult.isErr()).toBe(true);
  });

  it('returns value after rehydrate and compares by raw value', () => {
    const left = TestRehydratedValue.rehydrate('name');
    const right = TestRehydratedValue.rehydrate('name');
    const other = TestRehydratedValue.rehydrate('other');
    expect(left.isRehydrated()).toBe(true);
    expect(left.value().isOk()).toBe(true);
    expect(left.equals(right)).toBe(true);
    expect(left.equals(other)).toBe(false);
  });
});

describe('AggregateRoot', () => {
  it('collects and clears domain events', () => {
    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const aggregate = new TestAggregate(actorIdResult.value);
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
