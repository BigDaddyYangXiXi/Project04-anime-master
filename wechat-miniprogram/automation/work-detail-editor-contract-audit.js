const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../miniprogram/pages");
const detailWxml = fs.readFileSync(path.join(root, "work-detail/index.wxml"), "utf8");
const editorWxml = fs.readFileSync(path.join(root, "provider-profile/index.wxml"), "utf8");
const editorJs = fs.readFileSync(path.join(root, "provider-profile/index.js"), "utf8");
const creatorContent = fs.readFileSync(path.resolve(root, "../templates/creator-content.wxml"), "utf8");

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
assert(detailWxml.includes("work.code") && /<text\b[^>]*>作品码 \{\{selectedWork\.code\}\}/.test(editorWxml), "作品码必须在需求方可见、服务方以只读文字展示");
assert(!/<(?:input|textarea)\b[^>]*(?:selectedWork\.code|data-key="code")/.test(editorWxml), "作品码不能变成可编辑字段");
assert(detailWxml.includes("work.referenceCount") && creatorContent.includes("被参考 {{work.referenceCount || 0}} 次") && editorWxml.includes('<work-card work="{{coverPreviewWork}}"'), "参考次数必须由双端共用作品卡展示并保持系统只读");
assert(detailWxml.includes("relatedService.name") && detailWxml.includes("relatedService.description") && detailWxml.includes("relatedService.priceText"), "关联服务展示名称、说明和服务价格");
assert(editorWxml.includes("selectedWorkService.name") && editorWxml.includes('bindtap="openWorkPicker"'), "编辑方必须展示当前关联并保留服务关联编辑入口");
assert(detailWxml.indexOf('class="work-image-stack"') < detailWxml.indexOf('class="provider-head"'), "批准正片稿：首图先于作者行");
assert(detailWxml.indexOf('class="work-image-stack"') < detailWxml.indexOf('class="detail-title"'), "标题移到图集后，为图片释放首屏高度");
assert(!detailWxml.includes("main-bottom-nav"), "详情页不叠加全局导航");

const directDetailFields = new Set(Array.from(detailWxml.matchAll(/work\.([A-Za-z][A-Za-z0-9]*)/g), (match) => match[1]));
const governedFields = new Set([...Object.keys(editableFields), "provider", "tone", "code", "referenceCount", "creditCoser", "creditPhoto", "creditMakeup", "creditRetouch", "creditMine"]);
assert.deepStrictEqual([...directDetailFields].filter((field) => !governedFields.has(field)), [], "作品详情新增直接展示字段时，必须同步声明服务方编辑入口或系统只读规则");

process.stdout.write("Work detail/provider editor correspondence audit passed\n");
