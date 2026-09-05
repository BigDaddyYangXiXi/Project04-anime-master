const assert = require("assert");

const storage = new Map();
let pageDefinition = null;
let wentBack = false;
let toast = "";
let previewed = null;
const removedFiles = [];
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  navigateBack() { wentBack = true; },
  showToast({ title }) { toast = title; },
  previewImage(options) { previewed = options; },
  removeSavedFile({ filePath }) { removedFiles.push(filePath); }
};
global.Page = (definition) => { pageDefinition = definition; };

const helpers = require("../miniprogram/pages/brief/index.js");
const page = { data: JSON.parse(JSON.stringify(pageDefinition.data)) };
Object.keys(pageDefinition).forEach((key) => {
  if (key !== "data" && typeof pageDefinition[key] === "function") page[key] = pageDefinition[key].bind(page);
});
page.setData = (patch) => Object.assign(page.data, patch);
page.onLoad({ id: "PJ-AUTO", audit: "1" });

assert.ok(page.data.sourceCount > 0);
assert.strictEqual(page.data.city, "杭州");
assert.ok(page.data.location.includes("具体地点待确认"));
assert.ok(page.data.description.includes("夜航者角色妆造"));
assert.ok(!page.data.description.includes("13800138000"));
assert.ok(!page.data.description.includes("coser_ayao"));

page.updateDescription({ detail: { value: "" } });
assert.strictEqual(page.data.canSave, false);
page.save();
assert.ok(toast.includes("项目描述"));
assert.strictEqual(wentBack, false);
page.updateDescription({ detail: { value: "夜航者项目，需兼顾近景拍摄。" } });
assert.strictEqual(page.data.canSave, true);
page.setData({ targetImages: ["wxfile://target-old", "wxfile://target-keep"] });
page.previewTargetImage({ currentTarget: { dataset: { index: 1 } } });
assert.strictEqual(previewed.current, "wxfile://target-keep");
assert.strictEqual(previewed.urls.length, 2);
page.removeTargetImage({ currentTarget: { dataset: { index: 0 } } });
assert.deepStrictEqual(page.data.targetImages, ["wxfile://target-keep"]);
page.save();
const saved = storage.get("animeMasterProjects")[0];
assert.strictEqual(saved.description, "夜航者项目，需兼顾近景拍摄。");
assert.deepStrictEqual(saved.bookingIds, []);
assert.strictEqual(saved.briefSaved, true);
assert.deepStrictEqual(saved.targetImages, ["wxfile://target-keep"]);
assert.deepStrictEqual(removedFiles, ["wxfile://target-old"]);
assert.strictEqual(wentBack, true);
assert.strictEqual(helpers.validation({ projectName: "", date: "", city: "", location: "", description: "" }).canSave, false);
assert.strictEqual(helpers.MAX_TARGET_IMAGES, 6);
page.setData({ targetImages: Array(6).fill("wxfile://target") });
page.chooseTargetImages();
assert.strictEqual(toast, "最多添加 6 张图片");

process.stdout.write("B09 logic audit: 22 assertions passed\n");
