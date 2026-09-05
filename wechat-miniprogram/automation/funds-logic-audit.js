const assert = require("assert");
const fs = require("fs");
const path = require("path");
const storage = new Map();
let pageDefinition = null;
let modalTitle = "";
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  showToast() {},
  showModal({ title }) { modalTitle = title; }
};
global.Page = (definition) => { pageDefinition = definition; };
const { formatCents } = require("../miniprogram/pages/funds/index.js");
const store = require("../miniprogram/data/v063-store");

function create() {
  const page = { data: JSON.parse(JSON.stringify(pageDefinition.data)) };
  Object.keys(pageDefinition).forEach((key) => {
    if (key !== "data" && typeof pageDefinition[key] === "function") page[key] = pageDefinition[key].bind(page);
  });
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onShow();
  return page;
}

assert.strictEqual(formatCents(0), "0.00");
assert.strictEqual(formatCents(12345), "123.45");
assert.strictEqual(formatCents(-1), "0.00");
assert.strictEqual(formatCents("invalid"), "0.00");

const page = create();
assert.strictEqual(page.data.withdrawableBalance, "0.00", "资金账户缺省余额必须显示 0.00");
assert.ok(!page.data.entries.some((item) => item.key === "withdraw" || item.key === "recharge"), "充值与提现必须并列在余额卡，不得混入列表");
storage.set(store.KEYS.fundsAccount, { withdrawableBalanceCents: 12345 });
page.onShow();
assert.strictEqual(page.data.withdrawableBalance, "123.45", "可提现余额必须按分读取并保留两位小数");

page.openEntry({ currentTarget: { dataset: { key: "withdraw" } } });
assert.strictEqual(modalTitle, "提现尚未开通");
page.openEntry({ currentTarget: { dataset: { key: "recharge" } } });
assert.strictEqual(modalTitle, "充值尚未开通");

const wxml = fs.readFileSync(path.resolve(__dirname, "../miniprogram/pages/funds/index.wxml"), "utf8");
const wxss = fs.readFileSync(path.resolve(__dirname, "../miniprogram/pages/funds/index.wxss"), "utf8");
assert.ok(wxml.indexOf("balance-card") < wxml.indexOf("funds-hero"), "可提现余额必须位于资金页最上方");
assert.ok(/data-key="withdraw"[^]*data-key="recharge"/.test(wxml), "提现与充值必须相邻排列");
assert.ok(/\.balance-actions\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(wxss), "充值与提现必须使用等宽双列布局");
assert.ok(/\.balance-actions button\{[^}]*box-shadow:none/.test(wxss), "资金主操作不得带阴影");

process.stdout.write("Funds balance and recharge audit passed\n");
