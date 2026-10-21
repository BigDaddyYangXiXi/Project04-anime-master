const test = require('node:test');
const assert = require('node:assert/strict');
const keyboard = require('../miniprogram/utils/sheet-keyboard');
function page() {
  global.wx = {hideKeyboard(){}, getMenuButtonBoundingClientRect(){return {bottom:87}}};
  return { ...keyboard, data: { editorSection: 'contact', sheetKeyboardHeight: 0 },
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); } };
}
test('键盘高度变化保持当前字段为滚动目标，切换字段后更新目标', () => {
  const p = page();
  p.sheetInputFocus({currentTarget:{dataset:{field:'contact-wechat'}},detail:{height:340}});
  assert.equal(p.data.sheetKeyboardHeight,340);
  assert.equal(p.data.sheetScrollTarget,'contact-wechat');
  p.sheetInputFocus({currentTarget:{dataset:{field:'contact-phone'}},detail:{height:340}});
  assert.equal(p.data.sheetScrollTarget,'contact-phone');
  p.sheetKeyboardChange({detail:{height:0}});
  assert.equal(p.data.sheetKeyboardHeight,0);
  assert.equal(p.data.sheetScrollTarget,'');
});
test('关闭弹层收起键盘，延迟键盘事件不能重新顶起页面', () => {
  global.wx = {hideKeyboard(){}};
  const p=page();p.sheetInputFocus({currentTarget:{dataset:{field:'contact-name'}},detail:{height:340}});
  p.resetSheetKeyboard();p.data.editorSection='';
  p.sheetKeyboardChange({detail:{height:340}});
  assert.equal(p.data.sheetKeyboardHeight,0);
  assert.equal(p.sheetFocusedField,'');
});
