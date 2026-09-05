const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../miniprogram/pages");
const detailWxml = fs.readFileSync(path.join(root, "work-detail/index.wxml"), "utf8");
const editorWxml = fs.readFileSync(path.join(root, "provider-profile/index.wxml"), "utf8");
const editorJs = fs.readFileSync(path.join(root, "provider-profile/index.js"), "utf8");

const editableFields = {
  title: 'data-key="title"',
  subtitle: 'data-key="subtitle"',
  priceText: 'data-key="price"',
  description: 'data-key="description"',
  tags: 'data-key="tagsText"'
};

Object.entries(editableFields).forEach(([detailField, editorBinding]) => {
  assert(detailWxml.includes(`work.${detailField}`), `需求方作品详情必须继续展示 ${detailField}`);
  assert(editorWxml.includes(editorBinding), `服务方橱窗必须提供 ${detailField} 的对应编辑入口`);
});

assert(detailWxml.includes("gallery"), "需求方作品详情必须展示作品图片流");
assert(editorWxml.includes('bindtap="chooseWorkImages"'), "服务方橱窗必须提供作品图片编辑入口");
assert(editorWxml.includes('data-action="remove-work-image"') && editorJs.includes("removeWorkImage(event)"), "服务方橱窗必须允许移除已选作品图片");
assert(detailWxml.includes("work.code") && editorWxml.includes("作品码 {{selectedWork.code}}") && /系统生成[^<]*只读/.test(editorWxml), "作品码必须在需求方可见、服务方只读");
assert(detailWxml.includes("work.referenceCount") && editorWxml.includes("引用 {{item.referenceCount}} 次"), "引用次数必须双端可见且保持系统只读");

const directDetailFields = new Set(Array.from(detailWxml.matchAll(/work\.([A-Za-z][A-Za-z0-9]*)/g), (match) => match[1]));
const governedFields = new Set([...Object.keys(editableFields), "provider", "tone", "code", "referenceCount"]);
assert.deepStrictEqual([...directDetailFields].filter((field) => !governedFields.has(field)), [], "作品详情新增直接展示字段时，必须同步声明服务方编辑入口或系统只读规则");

process.stdout.write("Work detail/provider editor correspondence audit passed\n");
