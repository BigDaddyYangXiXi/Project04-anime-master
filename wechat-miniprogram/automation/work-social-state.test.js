const assert = require("node:assert/strict");
const test = require("node:test");
const saved = require("../miniprogram/services/cloud-saved-items");
let definition;
global.Page = (value) => { definition = value; };
require("../miniprogram/pages/work-detail/index");
delete global.Page;

function page() {
  return Object.assign({}, definition, {
    data: { work: { id: "work-1", provider: { id: "creator-1" } }, liked: false, followed: false, socialPending: false },
    socialCloudMode: true,
    setData(value) { Object.assign(this.data, value); }
  });
}

test("作品喜欢与作者关注分别写入各自实体，取消保持相同目标", async () => {
  const original = saved.setSaved;
  const calls = [];
  saved.setSaved = async (...args) => { calls.push(args); };
  try {
    const p = page();
    await p.toggleFollow();
    assert.equal(p.data.followed, true);
    assert.equal(p.data.liked, false);
    await p.toggleLike();
    await p.toggleLike();
    await p.toggleFollow();
    assert.deepEqual(calls, [["PROVIDER", "creator-1", true], ["WORK", "work-1", true], ["WORK", "work-1", false], ["PROVIDER", "creator-1", false]]);
  } finally { saved.setSaved = original; }
});

test("请求期间重复点击不产生重复关系写入", async () => {
  const original = saved.setSaved;
  let finish;
  let calls = 0;
  saved.setSaved = () => { calls++; return new Promise((resolve) => { finish = resolve; }); };
  try {
    const p = page();
    const pending = p.toggleLike();
    await p.toggleLike();
    await p.toggleFollow();
    assert.equal(calls, 1);
    assert.equal(p.data.liked, false);
    finish();
    await pending;
    assert.equal(p.data.liked, true);
    assert.equal(p.data.socialPending, false);
  } finally { saved.setSaved = original; }
});

test("保存失败保持原关系状态并允许重试", async () => {
  const original = saved.setSaved;
  const messages = [];
  global.wx = { showToast: (value) => messages.push(value.title) };
  saved.setSaved = async () => { throw new Error("offline"); };
  try {
    const p = page();
    p.data.followed = true;
    await p.toggleFollow();
    await p.toggleLike();
    assert.equal(p.data.followed, true);
    assert.equal(p.data.liked, false);
    assert.equal(p.data.socialPending, false);
    assert.equal(messages.length, 2);
  } finally { saved.setSaved = original; delete global.wx; }
});

test("服务方作品预览不能对自己触发关注或喜欢", async () => {
  const original = saved.setSaved;
  saved.setSaved = async () => { assert.fail("不应写入社交关系"); };
  try {
    const p = page();
    p.providerPreview = true;
    await p.toggleLike();
    await p.toggleFollow();
    assert.equal(p.data.liked, false);
    assert.equal(p.data.followed, false);
  } finally { saved.setSaved = original; }
});
