const assert = require("assert");
const { chooseWorkMedia } = require("../miniprogram/utils/work-media-picker");

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
assert.strictEqual(modal.title, "需要照片权限");
modal.success({ confirm: true });
assert.strictEqual(openedSettings, 1, "相册权限被拒绝后必须提供系统设置入口");

process.stdout.write("Work media picker permission audit passed\n");
