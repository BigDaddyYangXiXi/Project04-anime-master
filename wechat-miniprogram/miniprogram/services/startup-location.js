const performance = require('../utils/screen-performance');
// Refresh only previously consented location; never prompt from app lifecycle.
function cancel(app) {
  app.discoveryLocationRevision = (app.discoveryLocationRevision || 0) + 1;
  app.discoveryLocationReady = null;
  delete app.globalData.pendingDiscoveryLocation;
}
function hide(app) {
  cancel(app);
  app.discoveryLocationForeground = false;
}
function start(app, wxApi) {
  if (app.discoveryLocationForeground) return app.discoveryLocationReady;
  app.discoveryLocationForeground = true;
  let choice;
  try { choice = wxApi.getStorageSync && wxApi.getStorageSync('amFirstUseLocationChoiceV1'); } catch (_) { return null; }
  if (choice !== 'located'
    || !wxApi.getSetting || !wxApi.getPrivacySetting || !wxApi.getFuzzyLocation) return null;
  const revision = app.discoveryLocationRevision = (app.discoveryLocationRevision || 0) + 1;
  const current = () => revision === app.discoveryLocationRevision;
  const permissionTiming = performance.begin('location-permission');
  const request = Promise.all([
    new Promise((resolve, reject) => wxApi.getSetting({ success: resolve, fail: reject })),
    new Promise((resolve, reject) => wxApi.getPrivacySetting({ success: resolve, fail: reject }))
  ]).then(([settings, privacy]) => {
    if (!current()) return null;
    permissionTiming('checked');
    if (settings.authSetting?.['scope.userFuzzyLocation'] !== true || privacy.needAuthorization !== false) return null;
    const coordinateTiming = performance.begin('location-coordinate');
    return new Promise((resolve, reject) => wxApi.getFuzzyLocation({ type: 'gcj02',
      success: value => { if (current()) coordinateTiming('success'); resolve(value); },
      fail: error => { if (current()) coordinateTiming('failed'); reject(error); }
    }));
  }).then(value => {
    if (current() && value && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)) {
      app.globalData.pendingDiscoveryLocation = { latitude: value.latitude, longitude: value.longitude };
    }
  }).catch(() => { if (current()) permissionTiming('failed'); }).finally(() => {
    if (app.discoveryLocationReady === request) app.discoveryLocationReady = null;
  });
  app.discoveryLocationReady = request;
  return request;
}
module.exports = { start, cancel, hide };
