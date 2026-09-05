const assert = require("assert");

const storage = new Map();
let pageDefinition = null;
let navigatedTo = "";
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  navigateTo({ url }) { navigatedTo = url; }
};
global.Page = (definition) => { pageDefinition = definition; };

const helpers = require("../miniprogram/pages/projects/index.js");
const page = { data: JSON.parse(JSON.stringify(pageDefinition.data)) };
Object.keys(pageDefinition).forEach((key) => {
  if (key !== "data" && typeof pageDefinition[key] === "function") page[key] = pageDefinition[key].bind(page);
});
page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
page.onLoad({ audit: "1" });
page.onShow();

assert.strictEqual(page.data.projects.length, 1);
assert.strictEqual(page.data.projects[0].id, helpers.PROJECT_ID);
assert.strictEqual(page.data.projects[0].orderCount, 0);
assert.strictEqual(page.data.projects[0].bookingIds.length, 0);
assert.ok(page.data.projects[0].sourceOrderIds.length > 0);
assert.ok(page.data.projects[0].description.includes("夜航者角色妆造"));

page.openProject({ currentTarget: { dataset: { id: helpers.PROJECT_ID } } });
assert.strictEqual(navigatedTo, `/pages/project-detail/index?id=${helpers.PROJECT_ID}`);
page.createProject();
assert.ok(/^\/pages\/brief\/index\?id=PJ-\d+&new=1$/.test(navigatedTo));
assert.strictEqual(storage.get("animeMasterProjects").length, 2);

process.stdout.write("B07 logic audit: 9 assertions passed\n");
