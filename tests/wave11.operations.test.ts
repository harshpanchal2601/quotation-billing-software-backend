import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseProbe } from '../src/core/database/database-probe.js';
import { createRuntimeState } from '../src/core/observability/runtime.js';
import { createGracefulShutdown } from '../src/bootstrap/graceful-shutdown.js';

describe('Wave 11 bounded process lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('shares a stalled probe across concurrent requests and recovers after it settles', async () => {
    let release!: () => void;
    const query = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const probe = createDatabaseProbe(query, 100, 1000);
    const first = expect(probe()).rejects.toThrow('timed out');
    const second = expect(probe()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([first, second]);
    const third = expect(probe()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100);
    await third;
    expect(query).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await expect(probe()).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);
    const refreshed = probe();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await refreshed;
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('caches failed probes briefly and exposes no driver error', async () => {
    const query = vi.fn().mockRejectedValue(new Error('password=private-value'));
    const probe = createDatabaseProbe(query, 100);
    await expect(probe()).rejects.toThrow('Database probe unavailable');
    await expect(probe()).rejects.toThrow('Database probe unavailable');
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);
    query.mockResolvedValueOnce(undefined);
    await expect(probe()).resolves.toBeUndefined();
  });

  it('requires a successful recent cycle for an enabled worker, including while a later cycle stalls', () => {
    let now = 0;
    const state = createRuntimeState(() => now);
    expect(state.workerReady(false, 100)).toBe(true);
    state.configureWorker(true);
    state.workerStarted();
    expect(state.workerReady(true, 100)).toBe(false);
    state.workerFinished(true);
    expect(state.workerReady(true, 100)).toBe(true);
    state.workerStarted(); now = 101;
    expect(state.workerReady(true, 100)).toBe(false);
    state.workerFinished(false);
    expect(state.workerReady(true, 100)).toBe(false);
    state.workerStarted(); state.workerFinished(true);
    expect(state.workerReady(true, 100)).toBe(true);
    state.beginDrain();
    expect(state.workerReady(false, 100)).toBe(false);
    expect(state.workerReady(true, 100)).toBe(false);
  });

  function shutdownFixture() {
    let close!: () => void; let finishWorker!: () => void;
    const beginDrain = vi.fn(); const disconnect = vi.fn().mockResolvedValue(undefined);
    const closeHttp = vi.fn(() => new Promise<void>((resolve) => { close = resolve; }));
    const stopWorker = vi.fn(() => new Promise<void>((resolve) => { finishWorker = resolve; }));
    const forceClose = vi.fn(); const exit = vi.fn();
    const shutdown = createGracefulShutdown({ beginDrain, disconnect, closeHttp, stopWorker, forceClose, exit, deadlineMs: 100 });
    return { shutdown, beginDrain, disconnect, closeHttp, stopWorker, forceClose, exit, close: () => close(), finishWorker: () => finishWorker() };
  }

  it('marks draining immediately, stops claiming while HTTP drains and disconnects only after both finish', async () => {
    const fixture = shutdownFixture();
    const pending = fixture.shutdown('SIGTERM');
    expect(fixture.beginDrain).toHaveBeenCalledTimes(1);
    expect(fixture.shutdown('SIGINT')).toBe(pending);
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.closeHttp).toHaveBeenCalledTimes(1);
    expect(fixture.stopWorker).toHaveBeenCalledTimes(1);
    fixture.close(); await vi.advanceTimersByTimeAsync(0);
    expect(fixture.disconnect).not.toHaveBeenCalled();
    fixture.finishWorker(); await pending;
    expect(fixture.disconnect).toHaveBeenCalledTimes(1);
    expect(fixture.exit).toHaveBeenCalledWith(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(fixture.forceClose).not.toHaveBeenCalled();
  });

  it('forces a failing exit at the deadline without disconnecting beneath live work', async () => {
    const fixture = shutdownFixture();
    const pending = fixture.shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(100);
    expect(fixture.forceClose).toHaveBeenCalledTimes(1);
    expect(fixture.exit).toHaveBeenCalledWith(1);
    expect(fixture.disconnect).not.toHaveBeenCalled();
    fixture.close(); fixture.finishWorker(); await pending;
    expect(fixture.exit).toHaveBeenCalledTimes(1);
  });

  it('handles close/cleanup failure and preserves startup failure as a nonzero exit', async () => {
    const disconnect = vi.fn().mockRejectedValue(new Error('private DB connection'));
    const exit = vi.fn();
    const shutdown = createGracefulShutdown({ beginDrain: vi.fn(), closeHttp: vi.fn().mockResolvedValue(undefined), stopWorker: vi.fn().mockResolvedValue(undefined), disconnect, forceClose: vi.fn(), exit, deadlineMs: 100 });
    await shutdown('STARTUP_FAILURE');
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private DB connection');
  });

  it('does not disconnect beneath work whose drain failed', async () => {
    const disconnect = vi.fn(); const exit = vi.fn();
    const shutdown = createGracefulShutdown({ beginDrain: vi.fn(), closeHttp: vi.fn().mockRejectedValue(new Error('close failed')), stopWorker: vi.fn().mockResolvedValue(undefined), disconnect, forceClose: vi.fn(), exit, deadlineMs: 100 });
    await shutdown('SIGTERM');
    expect(disconnect).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
