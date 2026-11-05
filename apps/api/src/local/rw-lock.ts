// In-process readers/writer lock: every recorded local write holds a read
// lock from handler start until its outbox entry is saved; loading a
// snapshot (which replaces the tables) takes the write lock, so it never
// lands between a business write and its outbox entry.
export class RwLock {
  private readers = 0;
  private writer = false;
  private writersWaiting = 0;
  private waiters: (() => void)[] = [];

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((fn) => fn());
  }

  private wait() {
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  async acquireRead(): Promise<() => void> {
    // A waiting writer blocks new readers, or a busy shop would starve the snapshot load forever.
    while (this.writer || this.writersWaiting > 0) await this.wait();
    this.readers++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.readers--;
      this.wake();
    };
  }

  async withWrite<T>(fn: () => Promise<T>): Promise<T> {
    this.writersWaiting++;
    try {
      while (this.writer || this.readers > 0) await this.wait();
    } finally {
      this.writersWaiting--;
    }
    this.writer = true;
    try {
      return await fn();
    } finally {
      this.writer = false;
      this.wake();
    }
  }
}
