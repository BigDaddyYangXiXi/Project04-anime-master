const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");

const filename = path.resolve(__dirname, "../miniprogram/pages/auth/index.js");
const source = fs.readFileSync(filename, "utf8");
const localRequire = createRequire(filename);

function fixture(respond = () => ({ registered: false })) {
  const calls = [], routes = [], sessions = [], notices = [];
  const storage = new Map([["animeMasterRole", "provider"]]);
  const app = {globalData:{pendingRoute:"/pages/provider-home/index"},setServerSession: value=>sessions.push(value),takePostAuthRoute:()=>"/pages/orders/index"};
  const wx = { getStorageSync:key=>storage.get(key),
    setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),
    getPrivacySetting: ({ success }) => success({ needAuthorization: false }),
    requirePrivacyAuthorize: ({ success }) => success(),
    cloud: { callFunction: async (request) => {
      calls.push(request);
      return { result: { ok: true, data: await respond(request.data) } };
    } },
    showModal: (value) => notices.push(value),
    navigateTo: (value) => notices.push(value),
    reLaunch: ({ url }) => routes.push(url),
    getDeviceInfo: () => ({ platform: "devtools" }),
    canIUse: () => true
  };
  const authFilename = path.resolve(__dirname, "../miniprogram/services/cloud-auth.js");
  const preview = { exports: {} };
  const connectedConfig = { enabled: true, env: "test-environment" };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../miniprogram/utils/local-preview.js"), "utf8"), {
    wx, module: preview, require: () => connectedConfig
  });
  const auth = { exports: {} };
  vm.runInNewContext(fs.readFileSync(authFilename, "utf8"), {
    wx, module: auth, require: name => name === "../config/cloudbase" ? connectedConfig :
      name === "../utils/local-preview" ? preview.exports : createRequire(authFilename)(name)
  });
  let definition;
  vm.runInNewContext(source, {
    wx, require: (name) => name === "../../services/cloud-auth" ? auth.exports :
      name === "../../utils/local-preview" ? preview.exports : localRequire(name),
    Page: (value) => { definition = value; },
    getApp: () => app,
    setTimeout: (fn) => fn()
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  page.setData = (patch) => Object.assign(page.data, patch);
  return { page, calls, routes, sessions, notices, wx, app, storage };
}


const proof={detail:{code:'native-proof'}};
function ready(page){page.updateNickname({detail:{value:'桃桃'}});page.updateUsername({detail:{value:'John.Smith'}});page.toggleNotice();}
test('unregistered query is readonly and enters registration unchecked',async()=>{const {page,calls}=fixture();await page.checkSession();assert.equal(page.data.mode,'register');assert.equal(page.data.acceptedNotice,false);assert.deepEqual(calls.map(c=>c.data.action),['getSession']);});
test('existing account restores trusted session without a login click; audit parameters cannot bypass identity',async()=>{const {page,calls,routes,sessions}=fixture(()=>({registered:true,account:{nickname:'旧账号'}}));page.onLoad({audit:'1',state:'success'});await new Promise(r=>setImmediate(r));assert.equal(page.auditMode,false);assert.equal(page.data.success,false);assert.equal(sessions.length,1);assert.deepEqual(routes,['/pages/orders/index']);assert.equal(calls[0].data.action,'getSession');});
test('one register button is native before click when fields and consent are complete',()=>{const {page,calls}=fixture();page.submitRegister();assert.equal(page.data.fieldError,true);ready(page);assert.equal(page.data.canRegister,true);page.submitRegister();assert.equal(calls.length,0);const wxml=fs.readFileSync(path.resolve(__dirname,'../miniprogram/pages/auth/index.wxml'),'utf8');const expression=/open-type="\{\{([^"\n]+)\}\}"/.exec(wxml)[1];const openType=new Function('canRegister','processing','return '+expression);assert.equal(openType(true,false),'getRealtimePhoneNumber');assert.equal(openType(true,true),'');assert.equal(openType(false,false),'');assert.doesNotMatch(wxml,/授权手机号并注册|phoneReady|>继续</);});
test('missing or revoked consent cannot submit a phone credential',async()=>{const {page,calls}=fixture();ready(page);page.toggleNotice();assert.equal(page.data.canRegister,false);await page.authorizeRegistrationPhone(proof);assert.equal(calls.length,0);assert.equal(page.data.noticeError,true);});
test('valid native credential makes one registration request and lands as buyer despite old provider target',async()=>{const {page,calls,routes,storage,app}=fixture(()=>({registered:true,created:true,account:{id:'server'}}));ready(page);await page.authorizeRegistrationPhone(proof);assert.deepEqual(calls.map(c=>c.data.action),['phoneRegister']);assert.equal(calls[0].data.username,'John.Smith');assert.equal(calls[0].data.phoneCode,'native-proof');assert.equal(storage.get('animeMasterRole'),'buyer');assert.equal(app.globalData.pendingRoute,'');assert.deepEqual(routes,['/pages/discover/index']);});
test('idempotent registration completion also lands at buyer square',async()=>{const {page,routes,storage}=fixture(()=>({registered:true,created:false,account:{id:'server'}}));ready(page);await page.authorizeRegistrationPhone(proof);assert.equal(storage.get('animeMasterRole'),'buyer');assert.deepEqual(routes,['/pages/discover/index']);});
test('ordinary login retains its existing target and workspace',async()=>{const {page,routes,storage}=fixture(()=>({registered:true,account:{id:'server'}}));await page.submitLogin();assert.deepEqual(routes,['/pages/orders/index']);assert.equal(storage.get('animeMasterRole'),'provider');});
test('native phone denial sends no request and remains directly retryable',async()=>{const {page,calls}=fixture();ready(page);await page.authorizeRegistrationPhone({detail:{errMsg:'deny'}});assert.equal(calls.length,0);assert.equal(page.data.success,false);assert.equal(page.data.canRegister,true);});
test('privacy denial cannot create account and retry preserves fields',async()=>{const {page,calls,wx}=fixture(()=>({created:true,account:{id:'server'}}));ready(page);wx.getPrivacySetting=({success})=>success({needAuthorization:true});wx.requirePrivacyAuthorize=({fail})=>fail();await page.authorizeRegistrationPhone(proof);assert.equal(calls.length,0);assert.match(page.data.errorMessage,/隐私/);assert.equal(page.data.username,'John.Smith');wx.requirePrivacyAuthorize=({success})=>success();await page.authorizeRegistrationPhone(proof);assert.equal(calls.length,1);});
test('missing privacy API and failed privacy lookup cannot bypass consent',async()=>{for(const missing of [true,false]){const {page,calls,wx}=fixture();ready(page);if(missing)delete wx.getPrivacySetting;else wx.getPrivacySetting=({fail})=>fail();await page.authorizeRegistrationPhone(proof);assert.equal(calls.length,0);assert.equal(page.data.processing,false);}});
test('in-flight authorization prevents duplicate registration and edits',async()=>{let complete;const {page,calls,wx}=fixture(()=>({created:true,account:{id:'server'}}));ready(page);wx.getPrivacySetting=({success})=>success({needAuthorization:true});wx.requirePrivacyAuthorize=({success})=>{complete=success;};const pending=page.authorizeRegistrationPhone(proof);await page.authorizeRegistrationPhone(proof);page.updateUsername({detail:{value:'Changed'}});assert.equal(page.data.username,'John.Smith');complete();await pending;assert.equal(calls.length,1);});
test('backend rejection preserves input and original workspace',async()=>{const {page,storage}=fixture(()=>{throw {code:'NICKNAME_TAKEN'};});ready(page);await page.authorizeRegistrationPhone(proof);assert.equal(page.data.success,false);assert.equal(page.data.processing,false);assert.equal(page.data.canRegister,true);assert.match(page.data.errorMessage,/已被使用/);assert.equal(storage.get('animeMasterRole'),'provider');});
test('reentering registration clears consent; invalid edits remove native action',()=>{const {page}=fixture();ready(page);page.updateUsername({detail:{value:'invalid space'}});assert.equal(page.data.canRegister,false);page.switchMode({currentTarget:{dataset:{mode:'login'}}});page.switchMode({currentTarget:{dataset:{mode:'register'}}});assert.equal(page.data.acceptedNotice,false);assert.equal(page.data.canRegister,false);});
test('nickname limits and username character boundaries stay in force',()=>{const {page}=fixture();page.updateNickname({detail:{value:'名'.repeat(13)}});assert.equal(page.data.nicknameLength,12);page.toggleNotice();for(const username of ['Li','John.Smith','1Ab!']){page.updateUsername({detail:{value:username}});assert.equal(page.data.canRegister,true);}for(const username of ['J','a'.repeat(13),'John Smith','名字']){page.updateUsername({detail:{value:username}});assert.equal(page.data.canRegister,false);}});
test('SMS path remains explicitly unavailable without a fabricated verification',()=>{const {page,calls}=fixture();page.updatePhone({detail:{value:'13800138000'}});page.requestSmsCode();assert.match(page.data.errorMessage,/暂未开放/);assert.equal(calls.length,0);});
