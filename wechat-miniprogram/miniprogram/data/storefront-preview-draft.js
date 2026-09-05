let draft = null;
let published = false;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function stage(value) {
  draft = value ? clone(value) : null;
  published = false;
}

function get() { return draft ? clone(draft) : null; }
function markPublished() { if (draft) published = true; }
function isPublished() { return Boolean(draft && published); }

function consumePublished() {
  if (!isPublished()) return false;
  draft = null;
  published = false;
  return true;
}

function clear() {
  draft = null;
  published = false;
}

module.exports = { stage, get, markPublished, isPublished, consumePublished, clear };
