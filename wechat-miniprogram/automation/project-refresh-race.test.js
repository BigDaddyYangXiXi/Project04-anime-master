const test = require("node:test");
const assert = require("node:assert/strict");
const projects = require("../miniprogram/services/cloud-projects");
const orders = require("../miniprogram/services/cloud-orders");
global.getApp = () => ({ globalData: { account: { id: "a" } } });
const definitions = {};
for (const route of ["brief", "project-detail"]) {
  global.Page = value => { definitions[route] = value; };
  require(`../miniprogram/pages/${route}/index`);
}
delete global.Page;
function create(route) {
  const page = { ...definitions[route], data: structuredClone(definitions[route].data), cloudMode: true, projectId: "p",
    pendingSavedFiles: [], pendingCloudAssets: [] };
  page.setData = patch => Object.assign(page.data, patch);
  return page;
}
function pending() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const project = version => ({ id: "p", version, title: `version ${version}`, description: "description", bookingIds: [],
  targetImages: [`https://test/${version}`], targetImageAssets: [{ assetId: "a", fileId: "cloud://a", preview: `https://test/${version}` }] });
test('项目归组操作离页后不回写或刷新',async t=>{
 for(const action of ['linkOrder','unlinkOrder'])for(const failed of [false,true]){
  const page=create('project-detail'),response=pending();let modal,writes=0,reads=0,toasts=0;
  page.data.project=project(1);page.data.availableOrders=page.data.linkedOrders=[{orderId:'o'}];
  global.wx={showModal:value=>{modal=value;},showToast(){toasts++;}};
  t.mock.method(projects,action,()=>response.promise);
  let request=page[action]({currentTarget:{dataset:{index:0}}});
  if(action==='unlinkOrder')request=modal.success({confirm:true});
  page.onUnload();page.setData=()=>{writes++;};page.load=()=>{reads++;};
  if(failed)response.reject(Error('late'));else response.resolve({});
  await request;assert.equal(writes,0);assert.equal(reads,0);assert.equal(toasts,0);
 }
});
test('项目移出确认只适用于原版本，正常确认与取消保持原行为',async t=>{
 for(const state of ['changed','current','cancel','unloaded']){
  const page=create('project-detail');let modal,calls=0;
  page.data.project=project(1);page.data.linkedOrders=[{orderId:'o'}];page.load=async()=>{};
  global.wx={showModal:value=>{modal=value;},showToast(){}};
  t.mock.method(projects,'unlinkOrder',async()=>{calls++;});
  page.unlinkOrder({currentTarget:{dataset:{index:0}}});
  if(state==='changed')page.data.project=project(2);
  if(state==='unloaded')page.onUnload();
  await modal.success({confirm:state!=='cancel'});
  assert.equal(calls,state==='current'?1:0);
 }
});
for (const route of Object.keys(definitions)) {
  test(`${route}: old success and failure cannot overwrite the latest project and private image`, async t => {
    t.mock.method(orders, "listOrders", async () => []);
    for (const failure of [false, true]) {
      const one = pending(), two = pending(); let calls = 0;
      t.mock.method(projects, "getProject", () => ++calls === 1 ? one.promise : two.promise);
      const page = create(route);
      const first = page.load(), second = page.load();
      two.resolve(project(2)); await second;
      if (failure) one.reject(new Error("old failure")); else one.resolve(project(1));
      await first;
      assert.equal(page.data.project.version, 2);
      assert.equal(page.data.targetImageRows[0].url, "https://test/2");
      assert.equal(page.data.loadError, ""); assert.equal(page.data.loading, false);
    }
  });
  test(`${route}: unload or project switch discards late results; current failure can retry`, async t => {
    t.mock.method(orders, "listOrders", async () => []);
    for (const leave of ["unload", "switch"]) {
      const response = pending(); t.mock.method(projects, "getProject", () => response.promise);
      const page = create(route); const reading = page.load();
      if (leave === "unload") await page.onUnload(); else page.projectId = "other";
      page.setData = () => assert.fail("late update must be ignored");
      response.resolve(project(1)); await reading;
    }
    const page = create(route);
    t.mock.method(projects, "getProject", async () => { throw new Error("offline"); });
    await page.load(); assert.equal(page.data.loading, false); assert.notEqual(page.data.loadError, "");
    t.mock.method(projects, "getProject", async () => project(3));
    await page.load(); assert.equal(page.data.project.version, 3); assert.equal(page.data.loadError, "");
  });
}

for(const route of ['brief','project-detail'])test(route+': account change discards pending project success and failure',async t=>{
 for(const failure of [false,true]){
  let owner='a',writes=0;global.getApp=()=>({globalData:{account:{id:owner}}});
  const response=pending();t.mock.method(projects,'getProject',()=>response.promise);t.mock.method(orders,'listOrders',async()=>[]);
  const page=create(route),reading=page.load();owner='b';page.setData=()=>{writes++;};
  if(failure)response.reject(Error('late'));else response.resolve(project(1));await reading;assert.equal(writes,0);
 }
});
