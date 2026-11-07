import { LocalUpdateService } from './local-update.service';

describe('LocalUpdateService (mailbox between the UI and the desktop shell)', () => {
  beforeEach(() => {
    process.env.STOCKILY_APP_VERSION = '0.1.2';
  });

  it('a check request is handed to the shell once, and its answer shows up for the UI', () => {
    const s = new LocalUpdateService();
    expect(s.get()).toMatchObject({ phase: 'idle', current: '0.1.2' });
    expect(s.ask('check').phase).toBe('checking');
    expect(s.take()).toBe('check');
    expect(s.take()).toBeNull(); // collected once
    s.report({ phase: 'available', version: '0.2.0', notes: 'Nouveautés' });
    expect(s.get()).toMatchObject({ phase: 'available', version: '0.2.0', notes: 'Nouveautés', current: '0.1.2' });
    expect(s.get().checkedAt).toBeDefined();
  });

  it('install is only possible once an update was found; progress is reported', () => {
    const s = new LocalUpdateService();
    expect(s.ask('install').phase).toBe('idle'); // nothing found yet: ignored
    expect(s.take()).toBeNull();
    s.report({ phase: 'available', version: '0.2.0' });
    expect(s.ask('install').phase).toBe('downloading');
    expect(s.take()).toBe('install');
    s.report({ phase: 'downloading', downloaded: 5_000_000, total: 66_000_000 });
    expect(s.get()).toMatchObject({ phase: 'downloading', version: '0.2.0', downloaded: 5_000_000, total: 66_000_000 });
  });

  it('"already up to date" clears the version; double clicks while busy are ignored', () => {
    const s = new LocalUpdateService();
    s.report({ phase: 'available', version: '0.2.0' });
    s.report({ phase: 'uptodate' });
    expect(s.get().version).toBeUndefined();
    s.ask('check');
    s.take();
    expect(s.ask('check').phase).toBe('checking');
    expect(s.take()).toBeNull(); // no second request queued
  });

  it('a shell that never answers turns the request into a clear error instead of hanging', () => {
    jest.useFakeTimers();
    try {
      const s = new LocalUpdateService();
      s.ask('check');
      jest.advanceTimersByTime(31_000);
      const st = s.get();
      expect(st.phase).toBe('error');
      expect(st.error).toMatch(/ne répond pas/);
      expect(s.ask('check').phase).toBe('checking'); // can try again
    } finally {
      jest.useRealTimers();
    }
  });
});
