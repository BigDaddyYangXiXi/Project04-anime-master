const assert = require("assert");
let definition = null;
let pages = [];
let navigatedBack = 0;
let switchedTo = "";
global.Component = (value) => { definition = value; };
global.getCurrentPages = () => pages;
global.wx = {
  setStorageSync() {},
  navigateBack() { navigatedBack += 1; },
  switchTab({ url }) { switchedTo = url; }
};
require("../miniprogram/components/app-top-nav/index.js");

function goBack(workspace, previousPage) {
  navigatedBack = 0;
  switchedTo = "";
  pages = [previousPage, { route: "pages/provider-profile/index", data: {} }];
  definition.methods.goBack.call({ data: { showBack: true, workspace } });
}

goBack("provider", { route: "pages/me/index", data: { role: "buyer" } });
assert.strictEqual(navigatedBack, 0, "服务方页面不得返回需求方我的");
assert.strictEqual(switchedTo, "/pages/discover/index");

goBack("provider", { route: "pages/me/index", data: { role: "provider" } });
assert.strictEqual(navigatedBack, 1, "服务方页面应返回服务方我的");
assert.strictEqual(switchedTo, "");

goBack("buyer", { route: "pages/me/index", data: { role: "provider" } });
assert.strictEqual(navigatedBack, 0, "需求方页面不得返回服务方我的");
assert.strictEqual(switchedTo, "/pages/discover/index");

goBack("provider", { route: "pages/provider-detail/index", data: { navWorkspace: "provider" } });
assert.strictEqual(navigatedBack, 1, "服务方作品预览应返回服务方橱窗预览");

goBack("provider", { route: "pages/provider-detail/index", data: { navWorkspace: "buyer" } });
assert.strictEqual(navigatedBack, 0, "服务方预览不得接受需求方详情页作为返回来源");
assert.strictEqual(switchedTo, "/pages/discover/index");

process.stdout.write("Top navigation shared-role audit passed\n");

goBack('provider',{route:'pages/order-refund/index',data:{navWorkspace:'provider'}});
assert.strictEqual(navigatedBack,1,'服务方可返回自己的退款记录');
goBack('provider',{route:'pages/order-refund/index',data:{navWorkspace:'buyer'}});
assert.strictEqual(navigatedBack,0,'不得返回其他身份的退款记录');
goBack('buyer',{route:'pages/order-refund/index',data:{navWorkspace:'buyer'}});
assert.strictEqual(navigatedBack,1,'需求方可返回自己的退款记录');
goBack('buyer',{route:'pages/order-refund/index',data:{navWorkspace:'provider'}});
assert.strictEqual(navigatedBack,0,'需求方不得返回服务方退款记录');

for (const workspace of ['buyer','provider']) {
  for (const name of ['help','settings','support','me-social','me-activity']) {
    goBack(workspace,{route:'pages/'+name+'/index',data:{navWorkspace:workspace}});
    assert.strictEqual(navigatedBack,1,name+' must return within the same workspace');
    goBack(workspace,{route:'pages/'+name+'/index',data:{navWorkspace:workspace==='buyer'?'provider':'buyer'}});
    assert.strictEqual(navigatedBack,0,name+' must not cross workspace');
  }
}
