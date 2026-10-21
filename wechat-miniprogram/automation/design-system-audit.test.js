const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const audit = require("./design-system-audit");
const script = path.join(__dirname, "design-system-audit.js");

test("设计值引用不增加债务，但混合写入的局部数值仍被识别", () => {
  const dir = fs.mkdtempSync(path.join(__dirname, "../.artifacts/design-audit-"));
  const file = path.join(dir, "fixture.wxss");
  try {
    fs.writeFileSync(file, ".a {font-size: var(--am-type-body);gap:var(--am-space-2) 99rpx;color:#123456;} .b {font-size:28rpx}");
    const result = audit.literals(file);
    assert.equal(result["font-size: var(--am-type-body)"], undefined);
    assert.equal(result["gap: var(--am-space-2) 99rpx"], 1);
    assert.equal(result["color: #123456"], 1);
    assert.equal(result["font-size: 28rpx"], 1);
  } finally { fs.unlinkSync(file); fs.rmdirSync(dir); }
});

test("页面依赖图追踪全局样式和服务依赖", () => {
  const files = audit.dependencies("pages/work-detail/index");
  assert.ok(files.includes("miniprogram/app.wxss"));
  assert.ok(files.includes("miniprogram/services/cloud-saved-items.js"));
  assert.ok(files.includes("miniprogram/components/app-top-nav/index.wxss"));
});

test("喜欢模块影响包含全部四个消费页面和界面分支", () => {
  const result = spawnSync(process.execPath, [script, "impact", "like"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.requiresSemanticReview.map((page) => page.route).sort(), ["pages/me-assets/index", "pages/me-social/index", "pages/me/index", "pages/work-detail/index"]);
  assert.ok(report.requiresSemanticReview.every((page) => page.variants.length > 0));
});

test("未知修改路径不能被当成零影响通过", () => {
  const result = spawnSync(process.execPath, [script, "impact", "miniprogram/not-registered.wxss"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未识别影响范围/);
});

test("已存在的基线不能整体重新生成来隐藏设计债务", () => {
  const result = spawnSync(process.execPath, [script, "baseline"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /禁止无审查整体刷新/);
});
