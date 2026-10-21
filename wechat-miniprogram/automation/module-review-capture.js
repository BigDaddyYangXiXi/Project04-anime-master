// Current DevTools evidence only; audit fixtures do not prove production data or payment.
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const catalog = require('../design-system/catalog.json');
const output = path.resolve(__dirname, process.argv[2] || '../.artifacts/module-review-2026-09-09');
const params = {
  'work-detail': 'id=w-mu-1', 'provider-detail': 'id=1', 'provider-schedule': 'id=1',
  booking: 'providerId=1&workId=w-mu-1', 'booking-status': 'id=AM-260816-01&stage=REQUESTED',
  'order-detail': 'id=AM-260818-03', 'provider-request': 'id=AM-260816-01',
  'provider-task': 'id=AM-260816-01', 'project-detail': 'id=PJ-DEMO-0822',
  brief: 'id=PJ-DEMO-0822', fulfillment: 'id=AM-260823-07', review: 'id=AM-260824-08',
  'me-assets': 'type=liked'
};
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const app = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9422' });
  const only = process.argv[3] ? process.argv[3].split(',') : null;
  const reportFile = path.join(output, 'capture.json');
  const report = only && fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { capturedAt: new Date().toISOString(), evidence: 'DevTools audit fixtures; top/bottom viewports only, not all states', pages: [], errors: [] };
  const originalRole = await app.callWxMethod('getStorageSync', 'animeMasterRole');
  const originalPreview = await app.callWxMethod('getStorageSync', 'animeMasterLocalPreview');
  const orders = await app.callWxMethod('getStorageSync', 'anime-master-v063-orders');
  if (Array.isArray(orders) && orders.length) {
    const choose = stage => orders.find(order => order.stage === stage);
    for (const [page, stage] of Object.entries({ 'booking-status': 'REQUESTED', 'provider-request': 'REQUESTED', 'order-detail': 'IN_PRODUCTION', 'provider-task': 'NDA_PROVIDER_PENDING', fulfillment: 'DELIVERY_PENDING', review: 'COMPLETED' })) {
      const order = choose(stage);
      if (order) params[page] = `id=${encodeURIComponent(order.id)}`;
    }
  }
  const projects = await app.callWxMethod('getStorageSync', 'animeMasterProjects');
  if (Array.isArray(projects) && projects.length) {
    params['project-detail'] = params.brief = `id=${encodeURIComponent(projects[0].id)}`;
  }
  try {
    report.system = await app.systemInfo();
    await app.callWxMethod('setStorageSync', 'animeMasterLocalPreview', true);
    for (const entry of catalog.pages) {
      const name = entry.route.split('/')[1];
      if (only && !only.includes(name)) continue;
      const roles = ['discover', 'orders', 'projects', 'me'].includes(name) ? ['buyer', 'provider'] : [entry.roles[0] === 'provider' ? 'provider' : 'buyer'];
      for (const role of roles) {
        const id = `${name}-${role}`;
        try {
          await app.callWxMethod('setStorageSync', 'animeMasterRole', role);
          await app.reLaunch(`/${entry.route}?audit=1&${params[name] || ''}`);
          await new Promise(resolve => setTimeout(resolve, 1500));
          const current = await app.currentPage();
          await app.screenshot({ path: path.join(output, `${id}-top.png`) });
          await app.pageScrollTo(100000);
          await new Promise(resolve => setTimeout(resolve, 150));
          await app.screenshot({ path: path.join(output, `${id}-bottom.png`) });
          report.pages = report.pages.filter(item => item.id !== id);
          report.errors = report.errors.filter(item => item.id !== id);
          report.pages.push({ id, route: entry.route, actualRoute: current.path, role, modules: entry.modules, capturedAt: new Date().toISOString() });
          console.log(id);
        } catch (error) { report.errors.push({ id, error: error.message }); console.error(id, error.message); }
        fs.writeFileSync(path.join(output, 'capture.json'), JSON.stringify(report, null, 2));
      }
    }
  } finally {
    await app.callWxMethod('setStorageSync', 'animeMasterRole', originalRole || 'buyer');
    await app.callWxMethod('setStorageSync', 'animeMasterLocalPreview', originalPreview || false);
    app.disconnect();
  }
  if (report.errors.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
