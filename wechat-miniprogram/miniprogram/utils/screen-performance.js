// Local view-update diagnostics, not proof of image download or OS launch time.
const samples = [];
let launchedAt = null, generation = 0;
function launch() { launchedAt = Date.now(); }
function begin(screen) {
  const startedAt = Date.now(), revision = generation;
  let finished = false;
  return source => {
    if (finished || revision !== generation) return;
    finished = true;
    const now = Date.now();
    samples.push({ screen, source, milliseconds: now - startedAt,
      appLaunchMilliseconds: launchedAt === null ? null : now - launchedAt });
    if (samples.length > 50) samples.shift();
  };
}
function clear() { generation++; samples.length = 0; launchedAt = null; }
module.exports = { launch, begin, clear, read: () => samples.map(item => ({ ...item })) };
