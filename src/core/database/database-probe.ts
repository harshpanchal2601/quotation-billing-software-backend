// The timeout bounds the HTTP wait, not the underlying driver's query. Keep the
// same pending query until it settles so repeated probes cannot exhaust a pool.
export function createDatabaseProbe(query: () => Promise<void>, timeoutMs: number, cacheMs = 1000, now: () => number = Date.now) {
  let inFlight: Promise<void> | undefined;
  let cached: { healthy: boolean; at: number } | undefined;
  return async () => {
    if (cached && now() - cached.at < cacheMs) {
      if (!cached.healthy) throw new Error('Database probe unavailable');
      return;
    }
    if (!inFlight) {
      inFlight = Promise.resolve().then(query).then(() => {
        cached = { healthy: true, at: now() };
      }, () => {
        cached = { healthy: false, at: now() };
        throw new Error('Database probe unavailable');
      }).finally(() => { inFlight = undefined; });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([inFlight, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Database probe timed out')), timeoutMs);
      })]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
