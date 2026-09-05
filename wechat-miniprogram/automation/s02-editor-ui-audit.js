const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "miniprogram");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const wxml = read("pages", "provider-profile", "index.wxml");
const wxss = read("pages", "provider-profile", "index.wxss");
const js = read("pages", "provider-profile", "index.js");
const meJs = read("pages", "me", "index.js");
const detailWxml = read("pages", "provider-detail", "index.wxml");
const workCardWxss = read("components", "work-card", "index.wxss");

assert.ok(wxml.includes('class="readonly-field"') && wxml.includes("从账号资料读取"), "公开昵称必须读取账号资料并以只读态展示");
assert.ok(!/公开昵称\s*<input/.test(wxml), "公开昵称不得保留输入框");
assert.ok(wxml.includes("{{accountNickname") && js.includes('store.getAccount("provider").nickname'), "公开昵称必须直接读取服务方账号资料");
assert.ok(wxml.includes("常驻地") && detailWxml.includes("常驻地"), "供需两侧必须统一使用常驻地");
assert.ok(!wxml.includes("服务范围"), "橱窗编辑页不得保留服务范围旧称");
assert.ok(/\.profile-quick-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2/s.test(wxss), "昵称与常驻地必须使用紧凑双列结构");
assert.ok(/\.service-quick-grid\s*\{[^}]*grid-template-columns:/s.test(wxss), "名称、价格和单位必须使用紧凑同行结构");
assert.ok(wxml.includes('class="expand-control"') && js.includes("toggleServiceEditor(event)"), "每个服务项目必须提供右侧展开收起控件");
assert.ok(wxml.includes('class="work-picker-sheet"') && wxml.includes('class="picker-scroll" scroll-y'), "关联公开作品必须使用可滚动选择层");
assert.ok(wxml.includes('class="right-check') && /\.picker-work-row\s*\{[^}]*grid-template-columns:[^}]*52rpx/s.test(wxss), "作品勾选控件必须位于列表右侧");
assert.ok(!wxml.includes("checkbox-group"), "服务卡内不得常驻展开全部作品复选列表");
assert.ok(/\.upload-button\s*\{[^}]*min-width:\s*100%[^}]*max-width:\s*100%/s.test(wxss), "须知配图按钮必须左右顶格");
assert.ok(/\.danger-button\s*\{[^}]*min-width:\s*100%[^}]*max-width:\s*100%/s.test(wxss), "删除服务按钮必须左右顶格");
assert.ok(/\.dashed-button\s*\{[^}]*display:\s*flex[^}]*width:\s*100%[^}]*min-width:\s*100%[^}]*max-width:\s*100%/s.test(wxss), "新增服务项目按钮必须真正左右顶格");
assert.ok(js.includes("openWorkPicker(event)") && js.includes("confirmWorkPicker()") && js.includes("applyServiceWorks(index, selected"), "作品选择层必须确认后写回既有唯一关联逻辑");
assert.ok(wxml.includes('aria-label="主页标签预览"') && wxml.includes('aria-label="作品标签预览"'), "主页与作品标签输入后必须即时显示标签预览");
["height: 40rpx", "padding: 2rpx 16rpx", "border-radius: 8rpx", "color: #616161", "background: #efedef", "font-size: 24rpx", "line-height: 36rpx"].forEach((token) => {
  assert.ok(workCardWxss.includes(token) && wxss.includes(token), `编辑器标签必须复用作品卡视觉值：${token}`);
});
assert.ok(js.includes("function parseTags(value)") && js.includes("new Set") && js.includes("split(/[,，]/)"), "标签解析必须支持中英文逗号、去空项和去重复");
assert.ok(wxml.includes('wx:if="{{editorSection !== \'works\'}}" id="works-editor"'), "作品集管理必须始终出现在服务橱窗编辑页，不能再被 profile 入口隐藏");
assert.ok(/\.portfolio-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/s.test(wxss), "作品集管理必须使用双列作品卡");
assert.ok(wxml.includes('class="portfolio-pin"') && wxml.includes("置顶 {{pinnedDraft.length}} / 2") && js.includes("pinned.length >= 2"), "作品集必须提供右侧置顶控件并限制最多 2 件");
const workEditorRoute = "/pages/provider-profile/index?edit=1&section=works";
assert.ok(js.includes(workEditorRoute) && meJs.includes(workEditorRoute), "上传新作品必须复用我的页面上传作品路由");
assert.ok(wxml.includes("selectedWork && editorSection === 'works'") && wxml.indexOf("composer-media-scroll") < wxml.indexOf("composer-title") && wxml.indexOf("composer-title") < wxml.indexOf("composer-tags-field"), "单件上传页必须按图片、标题正文、标签的创作顺序排列");
assert.ok(wxml.includes('scroll-x enable-flex') && wxml.includes('class="composer-add-image"'), "作品图片必须使用横向缩略图带并在末尾保留加号卡");
assert.ok(/\.composer-title\s*\{[^}]*border:\s*0[^}]*border-bottom:/s.test(wxss) && /\.composer-body\s*\{[^}]*border:\s*0[^}]*border-bottom:/s.test(wxss), "标题和正文必须使用无卡片感的创作输入面");
assert.ok(wxml.includes('wx:if="{{editorSection !== \'works\'}}" class="page-intro"'), "上传作品页不得重复显示第二组页面标题");
assert.ok(!wxml.includes("语音") && !wxml.includes("麦克风"), "没有语音能力时不得照搬无效语音控件");
assert.ok(!wxml.includes("media-upload-card") && !wxml.includes("upload-empty") && !wxss.includes(".upload-empty"), "旧的大型后台式上传空态必须清除");
assert.ok(wxml.includes("bindtap=\"saveWork\"") && js.includes("saveWork()") && js.includes("canSaveWork(work)"), "单件作品必须使用独立保存门禁");

process.stdout.write("S02 compact editor UI audit passed\n");
