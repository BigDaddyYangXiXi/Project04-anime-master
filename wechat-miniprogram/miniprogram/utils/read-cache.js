// Only display reads listed here may be reused. Transaction decisions remain live.
const { bytes } = require('./cache-size');
const ITEM_BYTES = 256 * 1024, TOTAL_BYTES = 2 * 1024 * 1024;
const policies = {
  'project-api': { listProjects: 300000, getProject: 300000, getTargetImages: 300000 },
  'order-api': { listOrders: 30000 },
  'availability-api': { getMine: 30000, getPublic: 30000 },
  'catalog-read': { listProviders: 60000, listDiscovery: 60000, getProvider: 60000, getWork: 60000 },
  'saved-items-api': { listReceived: 30000 },
  'provider-catalog-draft': { getDraft: 30000 },
  'support-api': { list: 30000, get: 30000 }
};
const dependencies = {
  'project-api': ['project-api'],
  'order-api': ['order-api', 'project-api', 'availability-api'],
  'payment-api': ['order-api', 'project-api', 'availability-api'],
  'availability-api': ['availability-api', 'catalog-read'],
  'provider-catalog-draft': ['provider-catalog-draft', 'catalog-read'],
  'account-api': ['catalog-read'],
  'saved-items-api': ['saved-items-api'],
  'support-api': ['support-api'],
  'media-upload': ['project-api', 'catalog-read']
};
const entries = new Map(), pending = new Map(), versions = new Map();
let owner = null, generation = 0;
function currentOwner() { return typeof getApp === 'function' ? getApp()?.globalData?.account?.id || null : null; }
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function clear() { generation++; owner = null; entries.clear(); pending.clear(); versions.clear(); }
function invalidate(names) {
  for (const name of names) {
    versions.set(name, (versions.get(name) || 0) + 1);
    for (const [key, item] of entries) if (item.name === name) entries.delete(key);
    for (const [key, item] of pending) if (item.name === name) pending.delete(key);
  }
}
function run(options, fetch) {
  const account = currentOwner();
  if (account !== owner) { clear(); owner = account; }
  const name = options.name, action = options.data?.action || '';
  const ttl = policies[name]?.[action];
  const changed = dependencies[name] && !/^(get|list|find)/.test(action) ? dependencies[name] : null;
  if (changed) {
    const session = generation;
    invalidate(changed);
    return fetch().finally(() => { if (session === generation && account === currentOwner()) invalidate(changed); });
  }
  if (!account || !ttl) return fetch();
  const key = JSON.stringify(options), now = Date.now();
  for (const [savedKey, saved] of entries) {
    if (now < saved.at || now - saved.at >= saved.ttl) entries.delete(savedKey);
  }
  const cached = entries.get(key);
  if (cached && now >= cached.at && now - cached.at < ttl) {
    entries.delete(key); entries.set(key, cached);
    return Promise.resolve(copy(cached.value));
  }
  const existing = pending.get(key);
  if (existing) return existing.promise.then(copy);
  const session = generation, version = versions.get(name) || 0;
  const item = { name };
  item.promise = fetch().then(value => {
    if (value?.result?.ok && session === generation && account === currentOwner() && version === (versions.get(name) || 0)) {
      entries.delete(key);
      const size = bytes(value) + bytes(key);
      if (size <= ITEM_BYTES) {
        entries.set(key, { name, at: Date.now(), ttl, bytes: size, value: copy(value) });
        let total = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
        while (entries.size > 80 || total > TOTAL_BYTES) {
          const oldest = entries.keys().next().value;
          total -= entries.get(oldest).bytes; entries.delete(oldest);
        }
      }
    }
    return value;
  }).finally(() => { if (pending.get(key) === item) pending.delete(key); });
  pending.set(key, item);
  return item.promise.then(copy);
}
module.exports = { run, clear, policies };
