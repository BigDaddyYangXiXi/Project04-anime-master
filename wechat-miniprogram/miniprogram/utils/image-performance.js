// Local, bounded diagnostics only: no account IDs, file paths, URLs or image contents.
const samples = [];
async function measure(stage, run) {
  const started = Date.now();
  let ok = false;
  try { const result = await run(); ok = true; return result; }
  finally {
    samples.push({ stage, milliseconds: Date.now() - started, ok });
    if (samples.length > 100) samples.shift();
  }
}
module.exports = { measure, read: () => samples.map(item => ({ ...item })), clear: () => { samples.length = 0; } };
