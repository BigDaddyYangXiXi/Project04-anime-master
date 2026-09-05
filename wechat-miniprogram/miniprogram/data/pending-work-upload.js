let files = [];

function stage(nextFiles) {
  files = (Array.isArray(nextFiles) ? nextFiles : []).slice(0, 5);
}

function consume() {
  const pending = files;
  files = [];
  return pending;
}

function clear() { files = []; }

module.exports = { stage, consume, clear };
