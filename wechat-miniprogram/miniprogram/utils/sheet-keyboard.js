// Fixed sheets own keyboard avoidance; native inputs must set adjust-position=false.
module.exports = {
  sheetInputFocus(event) {
    this.sheetFocusedField = event.currentTarget.dataset.field;
    this.sheetKeyboardChange({ detail: { height: event.detail.height === undefined ? this.data.sheetKeyboardHeight : event.detail.height } });
  },
  sheetKeyboardChange(event) {
    if (!this.data.editorSection && !this.data.panel) return;
    const height = Math.max(0, Number(event.detail.height) || 0);
    const capsule = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    const window = wx.getWindowInfo ? wx.getWindowInfo() : null;
    const safeTop = capsule && capsule.bottom || window && window.safeArea && window.safeArea.top || 0;
    this.setData({ sheetSafeTop: safeTop, sheetKeyboardHeight: height, sheetScrollTarget: "" }, () => {
      if (height && this.sheetFocusedField) this.setData({ sheetScrollTarget: this.sheetFocusedField });
    });
  },
  resetSheetKeyboard() {
    this.sheetFocusedField = "";
    this.setData({ sheetKeyboardHeight: 0, sheetScrollTarget: "" });
    if (wx.hideKeyboard) wx.hideKeyboard();
  },
  preventSheetBackgroundScroll() {}
};
