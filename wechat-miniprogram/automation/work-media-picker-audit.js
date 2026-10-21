const assert = require("assert");
const { chooseWorkMedia, chooseImageMedia } = require("../miniprogram/utils/work-media-picker");

let modal = null;
let pickerOpened = 0;
let privacyRequests = 0;
let openedSettings = 0;
global.wx = {
  getPrivacySetting({ success }) { success({ needAuthorization: true }); },
  requirePrivacyAuthorize({ fail }) { privacyRequests += 1; fail({ errMsg: "requirePrivacyAuthorize:fail deny" }); },
  chooseMedia() { pickerOpened += 1; },
  showModal(options) { modal = options; },
  openSetting() { openedSettings += 1; },
  showToast() {}
};

chooseWorkMedia({ count: 5, success() {} });
assert.strictEqual(pickerOpened, 0, "隐私授权完成前不得打开相册");
assert.strictEqual(modal.title, "需要隐私授权");
modal.success({ confirm: true });
assert.strictEqual(privacyRequests, 2, "拒绝隐私授权后必须允许再次发起授权");

global.wx.getPrivacySetting = ({ success }) => success({ needAuthorization: false });
global.wx.chooseMedia = (options) => {
  pickerOpened += 1;
  assert.deepStrictEqual(options.sourceType, ["album"]);
  assert.deepStrictEqual(options.mediaType, ["image"]);
};
chooseWorkMedia({ count: 3, success() {} });
assert.strictEqual(pickerOpened, 1, "已有授权时必须直接打开相册");

global.wx.chooseMedia = (options) => options.fail({ errMsg: "chooseMedia:fail permission denied" });
chooseWorkMedia({ count: 3, success() {} });
assert.strictEqual(modal.title, "需要图片选择权限");
modal.success({ confirm: true });
assert.strictEqual(openedSettings, 1, "相册权限被拒绝后必须提供系统设置入口");

let selected = 0;
let toast = null;
global.wx.showToast = (options) => { toast = options; };
global.wx.chooseMedia = (options) => {
  assert.strictEqual(options.sourceType, undefined, "普通图片入口保留原生相册与相机默认范围");
  assert.deepStrictEqual(options.sizeType, ["compressed"]);
  assert.strictEqual(options.count, 2);
  options.success({ tempFiles: [] });
  options.success({ tempFiles: [{ tempFilePath: "selected.jpg" }] });
};
chooseImageMedia({ count: 2, sizeType: ["compressed"], success() { selected += 1; } });
assert.strictEqual(selected, 1, "空选择不得触发页面保存或上传");

modal = null;
global.wx.chooseMedia = ({ fail }) => fail({ errMsg: "chooseMedia:fail cancel" });
chooseImageMedia({ success() { throw new Error("取消不能保存"); } });
assert.strictEqual(modal, null);
assert.strictEqual(toast, null, "正常取消不应报错");

global.wx.chooseMedia = ({ fail }) => fail({ errMsg: "chooseMedia:fail privacy permission denied" });
chooseImageMedia({ success() {} });
assert.strictEqual(modal.title, "需要隐私授权", "隐私拒绝不能误导至照片权限设置");

global.wx.getPrivacySetting = ({ fail }) => fail({ errMsg: "privacy unavailable" });
global.wx.chooseMedia = () => { throw new Error("未知授权状态不能继续打开图片"); };
chooseImageMedia({ success() {} });
assert.strictEqual(toast.title, "授权状态读取失败，请重试");

global.wx.getPrivacySetting = ({ success }) => success({ needAuthorization: true });
global.wx.requirePrivacyAuthorize = ({ success }) => success();
global.wx.chooseMedia = ({ success }) => success({ tempFiles: [{ tempFilePath: "authorized.jpg" }] });
chooseImageMedia({ success() { selected += 1; } });
assert.strictEqual(selected, 2, "重试并同意后恢复选择");

delete global.wx.getPrivacySetting;
delete global.wx.requirePrivacyAuthorize;
chooseWorkMedia({ success() { selected += 1; } });
assert.strictEqual(selected, 3, "旧基础库由原生选择器处理授权");
process.stdout.write("Work and shared image picker permission audit passed\n");
