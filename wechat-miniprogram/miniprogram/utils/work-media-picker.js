function isCancelled(error) {
  return /cancel/i.test(String(error && error.errMsg || ""));
}

function needsPermission(error) {
  return /auth|permission|privacy|deny|denied/i.test(String(error && error.errMsg || ""));
}

function guideToSettings() {
  wx.showModal({
    title: "需要图片选择权限",
    content: "请在设置中检查照片或相机权限，返回后再次选择图片。",
    confirmText: "去设置",
    success({ confirm }) {
      if (confirm && wx.openSetting) wx.openSetting({});
    }
  });
}

function guidePrivacy(retry) {
  wx.showModal({
    title: "需要隐私授权",
    content: "添加图片需要使用你选择的照片。授权后才会打开图片选择。",
    confirmText: "重新授权",
    success({ confirm }) {
      if (confirm) retry();
    }
  });
}

function chooseImageMedia({ count = 5, sourceType, sizeType, success }) {
  const openAlbum = () => wx.chooseMedia({
    count,
    mediaType: ["image"],
    ...(sourceType ? { sourceType } : {}),
    ...(sizeType ? { sizeType } : {}),
    success(result) {
      if (result.tempFiles && result.tempFiles.length) success(result);
    },
    fail(error) {
      if (isCancelled(error)) return;
      if (/privacy/i.test(String(error && error.errMsg || ""))) return guidePrivacy(retry);
      if (needsPermission(error)) return guideToSettings();
      wx.showToast({ title: "无法选择图片，请稍后重试", icon: "none" });
    }
  });
  const retry = () => chooseImageMedia({ count, sourceType, sizeType, success });

  if (!wx.getPrivacySetting || !wx.requirePrivacyAuthorize) {
    openAlbum();
    return;
  }
  wx.getPrivacySetting({
    success({ needAuthorization }) {
      if (!needAuthorization) return openAlbum();
      wx.requirePrivacyAuthorize({ success: openAlbum, fail: () => guidePrivacy(retry) });
    },
    fail: () => wx.showToast({ title: "授权状态读取失败，请重试", icon: "none" })
  });
}

function chooseWorkMedia({ count = 5, success }) {
  return chooseImageMedia({ count, sourceType: ["album"], sizeType: ["compressed"], success });
}

module.exports = { chooseWorkMedia, chooseImageMedia, isCancelled, needsPermission };
