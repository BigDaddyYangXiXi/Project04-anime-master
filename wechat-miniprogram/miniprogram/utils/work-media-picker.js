function isCancelled(error) {
  return /cancel/i.test(String(error && error.errMsg || ""));
}

function needsPermission(error) {
  return /auth|permission|privacy|deny|denied/i.test(String(error && error.errMsg || ""));
}

function guideToSettings() {
  wx.showModal({
    title: "需要照片权限",
    content: "请在设置中允许动漫高手访问照片，返回后再次点击上传作品。",
    confirmText: "去设置",
    success({ confirm }) {
      if (confirm && wx.openSetting) wx.openSetting({});
    }
  });
}

function guidePrivacy(retry) {
  wx.showModal({
    title: "需要隐私授权",
    content: "上传作品需要使用你选择的照片。授权后才会打开相册。",
    confirmText: "重新授权",
    success({ confirm }) {
      if (confirm) retry();
    }
  });
}

function chooseWorkMedia({ count = 5, success }) {
  const openAlbum = () => wx.chooseMedia({
    count,
    mediaType: ["image"],
    sourceType: ["album"],
    sizeType: ["compressed"],
    success,
    fail(error) {
      if (isCancelled(error)) return;
      if (needsPermission(error)) return guideToSettings();
      wx.showToast({ title: "无法打开相册，请稍后重试", icon: "none" });
    }
  });

  if (!wx.getPrivacySetting || !wx.requirePrivacyAuthorize) {
    openAlbum();
    return;
  }
  wx.getPrivacySetting({
    success({ needAuthorization }) {
      if (!needAuthorization) return openAlbum();
      wx.requirePrivacyAuthorize({ success: openAlbum, fail: () => guidePrivacy(() => chooseWorkMedia({ count, success })) });
    },
    fail: openAlbum
  });
}

module.exports = { chooseWorkMedia, isCancelled, needsPermission };
