// Fixed read-only queries, reachable only after the existing operator-token gate.
async function rdbExactCount(sdk) {
  const samples = [];
  try {
    const db = sdk.init({ env: 'cloudbase-d2g65rqbvee0bd978', timeout: 8000, retries: 0 }).rdb();
    for (const type of ['PROVIDER', 'WORK']) {
      for (const head of [true, false]) {
        const started = Date.now();
        const result = await db.from('account_saved_items').select('target_id', { head, count: 'exact' })
          .eq('target_type', type).eq('saved', 1).limit(1);
        samples.push({ type, head, ms: Date.now() - started, error: !!result.error,
          count: Number.isSafeInteger(result.count) && result.count >= 0 ? result.count : null });
      }
    }
    return { ok: samples.every(s => !s.error && s.count !== null)
      && samples[0].count === samples[1].count && samples[2].count === samples[3].count, samples };
  } catch { return { ok: false, code: 'RDB_COUNT_PROBE_FAILED', samples }; }
}
module.exports = { rdbExactCount };
