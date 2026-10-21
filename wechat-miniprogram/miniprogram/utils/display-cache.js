// Display snapshots only; never used to authorize actions or settle transactions.
const KEY = 'animeMasterDisplayCacheV1';
const { bytes } = require('./cache-size');
const ITEM_BYTES = 128 * 1024, TOTAL_BYTES = 512 * 1024;
let revision = 0;
const TTL = 5 * 60 * 1000;
function owner() { const app = typeof getApp === 'function' ? getApp() : null; return app && app.globalData && app.globalData.account && app.globalData.account.id; }
function entries() { try { const value = wx.getStorageSync(KEY); return Array.isArray(value) ? value : []; } catch (_) { return []; } }
function read(key) {
  const id = owner();
  if (!id) return null;
  const item = entries().find(item => item && item.owner === id && item.key === key && Date.now() >= item.at && Date.now() - item.at < TTL && bytes(item) <= ITEM_BYTES);
  return item ? JSON.parse(JSON.stringify(item.value)) : null;
}
function write(key, value, expectedOwner = owner(), expectedRevision = revision) {
  if (!expectedOwner || owner() !== expectedOwner || expectedRevision !== revision) return;
  try {
    const items = entries().filter(item => item && item.owner === expectedOwner && item.key !== key && Date.now() >= item.at && Date.now() - item.at < TTL && bytes(item) <= ITEM_BYTES);
    const item = { owner: expectedOwner, key, at: Date.now(), value };
    if (bytes(item) > ITEM_BYTES) return;
    const next = [item, ...items].slice(0, 6);
    while (bytes(next) > TOTAL_BYTES) next.pop();
    // Keep 1 MiB free for preferences and unfinished user actions. Never clear them.
    if (typeof wx.getStorageInfoSync !== 'function') return;
    const { currentSize, limitSize } = wx.getStorageInfoSync();
    if (!Number.isFinite(currentSize) || currentSize < 0 || !Number.isFinite(limitSize)
      || currentSize + Math.ceil(bytes(next) / 1024) > limitSize - 1024) return;
    wx.setStorageSync(KEY, next);
  } catch (_) {} // Cache failure must not fail the real read.
}
function clear() { revision++; try { wx.removeStorageSync(KEY); } catch (_) {} }
module.exports = { read, write, clear, owner, revision: () => revision };
