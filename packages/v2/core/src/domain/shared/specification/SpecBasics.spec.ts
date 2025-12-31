import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { AndSpec, andSpec } from './AndSpec';
import type { ISpecification } from './ISpecification';
import type { ISpecVisitor } from './ISpecVisitor';
import { NotSpec, notSpec } from './NotSpec';
import { OrSpec, orSpec } from './OrSpec';
import { SpecBuilder, type SpecBuilderMode } from './SpecBuilder';
import { AbstractSpecFilterVisitor } from './visitors/AbstractSpecFilterVisitor';
import { isSpecFilterVisitor } from './visitors/ISpecFilterVisitor';
import { NoopSpecVisitor } from './visitors/NoopSpecVisitor';

class TestSpec implements ISpecification<string, ISpecVisitor> {
  constructor(
    private readonly cond: string,
    private readonly predicate: (value: string) => boolean,
    private readonly mutateFn: (value: string) => string
  ) {}

  isSatisfiedBy(value: string): boolean {
    return this.predicate(value);
  }

  mutate(value: string) {
    return ok(this.mutateFn(value));
  }

  accept(visitor: ISpecVisitor) {
    const visited = visitor.visit(this);
    if (isSpecFilterVisitor(visitor)) {
      return visited.andThen(() => visitor.addCond(this.cond));
    }
    return visited;
  }
}

class SpyVisitor implements ISpecVisitor {
  readonly calls: string[] = [];

  visit(spec: ISpecification): ReturnType<ISpecVisitor['visit']> {
    this.calls.push(spec.constructor.name);
    return ok(undefined);
  }
}

class TestFilterVisitor extends AbstractSpecFilterVisitor<string> {
  clone(): this {
    const next = new TestFilterVisitor() as this;
    this.where().match(
      (current) => {
        next.addCond(current)._unsafeUnwrap();
      },
      () => undefined
    );
    return next;
  }

  and(left: string, right: string): string {
    return `(${left} AND ${right})`;
  }

  or(left: string, right: string): string {
    return `(${left} OR ${right})`;
  }

  not(inner: string): string {
    return `(NOT ${inner})`;
  }
}

class TestSpecBuilder extends SpecBuilder<string, ISpecVisitor, TestSpecBuilder> {
  constructor(mode: SpecBuilderMode = 'and') {
    super(mode);
  }

  add(spec: ISpecification<string, ISpecVisitor>): TestSpecBuilder {
    this.addSpec(spec);
    return this;
  }

  fail(message: string): TestSpecBuilder {
    this.recordError(message);
    return this;
  }

  andGroup(build: (builder: TestSpecBuilder) => TestSpecBuilder): TestSpecBuilder {
    this.addGroup('and', build);
    return this;
  }

  orGroup(build: (builder: TestSpecBuilder) => TestSpecBuilder): TestSpecBuilder {
    this.addGroup('or', build);
    return this;
  }

  protected createChild(mode: SpecBuilderMode): TestSpecBuilder {
    return new TestSpecBuilder(mode);
  }
}

describe('spec visitors', () => {
  it('detects filter visitors', () => {
    expect(isSpecFilterVisitor({})).toBe(false);
    expect(isSpecFilterVisitor(new TestFilterVisitor())).toBe(true);
  });

  it('tracks where conditions in AbstractSpecFilterVisitor', () => {
    const visitor = new TestFilterVisitor();
    visitor.where()._unsafeUnwrapErr();

    const first = visitor.addCond('A');
    first._unsafeUnwrap();
    const second = visitor.addCond('B');
    second._unsafeUnwrap();
    const whereResult = visitor.where();
    whereResult._unsafeUnwrap();

    expect(whereResult._unsafeUnwrap()).toBe('(A AND B)');

    const clone = visitor.clone();
    const cloneWhere = clone.where();
    cloneWhere._unsafeUnwrap();

    expect(cloneWhere._unsafeUnwrap()).toBe('(A AND B)');
  });
});

describe('AndSpec/OrSpec/NotSpec', () => {
  it('combines satisfaction checks and mutate operations', () => {
    const left = new TestSpec(
      'LEFT',
      (value) => value.startsWith('left'),
      (value) => `${value}-L`
    );
    const right = new TestSpec(
      'RIGHT',
      (value) => value.endsWith('right'),
      (value) => `${value}-R`
    );

    const andSpecInstance = new AndSpec(left, right);
    expect(andSpecInstance.isSatisfiedBy('left-right')).toBe(true);
    const andResult = andSpecInstance.mutate('left-right');
    andResult._unsafeUnwrap();

    expect(andResult._unsafeUnwrap()).toBe('left-right-L-R');

    const orSpecInstance = new OrSpec(left, right);
    expect(orSpecInstance.isSatisfiedBy('left-only')).toBe(true);
    const orResult = orSpecInstance.mutate('left-only');
    orResult._unsafeUnwrap();

    expect(orResult._unsafeUnwrap()).toBe('left-only-L');

    const missResult = orSpecInstance.mutate('neither');
    missResult._unsafeUnwrap();

    expect(missResult._unsafeUnwrap()).toBe('neither');

    const notSpecInstance = new NotSpec(left);
    expect(notSpecInstance.isSatisfiedBy('left-only')).toBe(false);
    const notResult = notSpecInstance.mutate('left-only');
    notResult._unsafeUnwrap();

    expect(notResult._unsafeUnwrap()).toBe('left-only');
  });

  it('accepts standard visitors', () => {
    const left = new TestSpec(
      'LEFT',
      () => true,
      (value) => value
    );
    const right = new TestSpec(
      'RIGHT',
      () => true,
      (value) => value
    );
    const visitor = new SpyVisitor();

    const andSpecInstance = new AndSpec(left, right);
    const andResult = andSpecInstance.accept(visitor);
    andResult._unsafeUnwrap();
    expect(visitor.calls[0]).toBe('AndSpec');
    expect(visitor.calls.length).toBe(3);
  });

  it('accepts filter visitors and builds conditions', () => {
    const left = new TestSpec(
      'LEFT',
      () => true,
      (value) => value
    );
    const right = new TestSpec(
      'RIGHT',
      () => true,
      (value) => value
    );

    const orVisitor = new TestFilterVisitor();
    const orSpecInstance = new OrSpec(left, right);
    orSpecInstance.accept(orVisitor)._unsafeUnwrap();
    const orWhere = orVisitor.where();

    expect(orWhere._unsafeUnwrap()).toBe('(LEFT OR RIGHT)');

    const notVisitor = new TestFilterVisitor();
    const notSpecInstance = new NotSpec(left);
    notSpecInstance.accept(notVisitor)._unsafeUnwrap();
    const notWhere = notVisitor.where();

    expect(notWhere._unsafeUnwrap()).toBe('(NOT LEFT)');
  });

  it('exposes helper factories', () => {
    const left = new TestSpec(
      'LEFT',
      () => true,
      (value) => value
    );
    const right = new TestSpec(
      'RIGHT',
      () => true,
      (value) => value
    );
    andSpec(left, right)._unsafeUnwrap();
    orSpec(left, right)._unsafeUnwrap();
    notSpec(left)._unsafeUnwrap();
  });
});

describe('SpecBuilder', () => {
  it('fails when empty or errored', () => {
    const emptyResult = new TestSpecBuilder().build();
    emptyResult._unsafeUnwrapErr();

    const errorResult = new TestSpecBuilder().fail('Bad spec').build();
    errorResult._unsafeUnwrapErr();
    expect(errorResult._unsafeUnwrapErr().message).toContain('Bad spec');
  });

  it('builds combined specifications', () => {
    const left = new TestSpec(
      'LEFT',
      () => true,
      (value) => value
    );
    const right = new TestSpec(
      'RIGHT',
      () => true,
      (value) => value
    );

    const andBuilder = new TestSpecBuilder().add(left).add(right);
    const andResult = andBuilder.build();
    andResult._unsafeUnwrap();

    expect(andResult._unsafeUnwrap() instanceof AndSpec).toBe(true);

    const orBuilder = new TestSpecBuilder('or').add(left).add(right);
    const orResult = orBuilder.build();
    orResult._unsafeUnwrap();

    expect(orResult._unsafeUnwrap() instanceof OrSpec).toBe(true);
  });

  it('adds groups through child builders', () => {
    const left = new TestSpec(
      'LEFT',
      () => true,
      (value) => value
    );
    const right = new TestSpec(
      'RIGHT',
      () => true,
      (value) => value
    );

    const builder = new TestSpecBuilder();
    builder.add(left);
    builder.andGroup((child) => child.add(right));
    const result = builder.build();
    result._unsafeUnwrap();

    expect(result._unsafeUnwrap() instanceof AndSpec).toBe(true);
  });

  it('reports group errors', () => {
    const builder = new TestSpecBuilder();
    builder.andGroup((child) => child.fail('Group error'));
    const result = builder.build();
    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toContain('Group error');
  });

  it('supports noop visitor', () => {
    const spec = new TestSpec(
      'COND',
      () => true,
      (value) => value
    );
    const visitor = new NoopSpecVisitor();
    const result = spec.accept(visitor);
    result._unsafeUnwrap();
  });
});
