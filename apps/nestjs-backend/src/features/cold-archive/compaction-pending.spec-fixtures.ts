type FakeCommand = 'sadd' | 'srem' | 'sscan' | 'exists' | 'setex' | 'del' | 'expire';

/** in-memory stand-in for the redis commands the pending-set helpers use */
export class FakePendingRedis {
  sets = new Map<string, Set<string>>();
  strings = new Map<string, string>();
  ttls = new Map<string, number>();
  available = true;
  /** when set, the next matching command throws it (a redis blip) */
  failNext?: { command: FakeCommand; error: Error };

  private failIf(command: FakeCommand) {
    if (this.failNext?.command !== command) return;
    const { error } = this.failNext;
    this.failNext = undefined;
    throw error;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    this.failIf('sadd');
    const set = this.sets.get(key) ?? new Set<string>();
    this.sets.set(key, set);
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) added += 1;
      set.add(member);
    }
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    this.failIf('srem');
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed += 1;
    }
    if (set.size === 0) {
      this.sets.delete(key);
      this.ttls.delete(key);
    }
    return removed;
  }

  /** pages of two, cursor = index into the member list, so multi-page reads are exercised */
  async sscan(key: string, cursor: string, count: number): Promise<[string, string[]]> {
    this.failIf('sscan');
    const all = [...(this.sets.get(key) ?? [])];
    const start = Number(cursor);
    const end = Math.min(all.length, start + Math.min(count, 2));
    return [end >= all.length ? '0' : String(end), all.slice(start, end)];
  }

  async exists(key: string): Promise<boolean> {
    this.failIf('exists');
    return this.strings.has(key) || (this.sets.get(key)?.size ?? 0) > 0;
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.failIf('expire');
    if (this.strings.has(key) || this.sets.has(key)) this.ttls.set(key, seconds);
  }

  async del(key: string): Promise<void> {
    this.failIf('del');
    this.strings.delete(key);
    this.ttls.delete(key);
    this.sets.delete(key);
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    this.failIf('setex');
    this.strings.set(key, value);
    this.ttls.set(key, seconds);
  }

  members(key: string): string[] {
    return [...(this.sets.get(key) ?? [])].sort();
  }
}
