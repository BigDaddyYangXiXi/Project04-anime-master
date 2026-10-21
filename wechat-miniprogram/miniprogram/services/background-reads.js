// See design-system/PRELOAD-POLICY.md. Warm display reads after first content.
const cloudCall = require('../utils/cloud-call');
const cloudAccount = require('./cloud-account');
const cloudProjects = require('./cloud-projects');
const cloudOrders = require('./cloud-orders');
const cloudSavedItems = require('./cloud-saved-items');
const cloudCatalog = require('./cloud-catalog');
let pending = null, last = null;
function clearCache() {
  if (pending) clearTimeout(pending.timer);
  pending = null;
  last = null;
}
function schedule(role) {
  const app = typeof getApp === 'function' ? getApp() : null;
  const owner = app?.globalData?.account?.id;
  if (!owner || app.sessionRestoring || app.globalData.background || !cloudProjects.isAvailable()) return;
  const state = cloudCatalog.peekStorefrontState();
  const draft = cloudCatalog.peekDraft();
  role = state?.draftVersion > 0 || state?.hasPublication || draft?.version > 0 || role === 'provider' ? 'provider' : 'buyer';
  const now = Date.now();
  if (pending && pending.owner === owner && pending.revision === app.sessionRevision) return;
  if (last && last.owner === owner && last.revision === app.sessionRevision && now >= last.at && now - last.at < 60000) return;
  if (pending) clearTimeout(pending.timer);
  const task = pending = { owner, role, revision: app.sessionRevision, deadline: now + 15000, timer: null };
  const current = () => pending === task && app.globalData.account?.id === owner
    && app.sessionRevision === task.revision && !app.globalData.background;
  const storefront = [
    () => cloudCatalog.prefetchDraft(),
    () => cloudCatalog.getProvider(owner, { images: false })
  ];
  const orders = () => cloudOrders.listOrders();
  const projects = () => cloudProjects.listProjects();
  const jobs = role === 'provider' ? [...storefront, orders, projects] : [projects, orders, ...storefront];
  jobs.push(() => cloudAccount.getMine(), () => cloudSavedItems.listMine());
  async function step() {
    if (!current() || Date.now() > task.deadline) { if (pending === task) pending = null; return; }
    if (cloudCall.isBusy() || app.discoveryLocationReady || app.globalData.pendingDiscoveryLocation) {
      task.timer = setTimeout(step, 800);
      return;
    }
    {
      const network = await new Promise(resolve => {
        if (!wx.getNetworkType) return resolve('');
        wx.getNetworkType({ success: value => resolve(value.networkType), fail: () => resolve('') });
      }).catch(() => '');
      if (!current() || Date.now() > task.deadline || !['wifi', '4g', '5g'].includes(network)) {
        if (pending === task) pending = null;
        return;
      }
      if (cloudCall.isBusy() || app.discoveryLocationReady || app.globalData.pendingDiscoveryLocation) {
        task.timer = setTimeout(step, 800);
        return;
      }
    }
    last = { owner, revision: task.revision, at: Date.now() };
    try { await jobs.shift()(); } catch (_) {} // Optional reads never block navigation or show errors.
    if (!current()) { if (pending === task) pending = null; return; }
    if (jobs.length) task.timer = setTimeout(step, 800);
    else pending = null;
  }
  task.timer = setTimeout(step, 800);
}
module.exports = { schedule, clearCache };
