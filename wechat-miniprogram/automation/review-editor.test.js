const test = require('node:test');
const assert = require('node:assert/strict');
const cloud = require('../miniprogram/services/cloud-orders');
let definition;
global.Page = value => { definition = value; };
require('../miniprogram/pages/provider-reviews/index');
delete global.Page;
function page() {
  return Object.assign({}, definition, {
    data: { reviews: [{id:'a',version:3},{id:'b'},{id:'done',reviewReply:'已回复'}], drafts:{a:'保留的草稿'}, editingReplyId:'',pendingId:'' },
    setData(value) { Object.assign(this.data,value); },
    refresh() {}
  });
}
const event=id=>({currentTarget:{dataset:{id}}});
test('评价列表只接收最新刷新，卸载后不回写',async t=>{
 for(const mode of ['old-success','old-failure','unload']){
  const p=page();p.cloudMode=true;p.refresh=definition.refresh;
  let resolve,reject,calls=0,writes=0;
  const old=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const current=[{id:'a',version:4,viewerRole:'PROVIDER',stage:'COMPLETED',rating:5,reviewReply:'最新回复'}];
  t.mock.method(cloud,'listOrders',()=>++calls===1?old:Promise.resolve(current));
  const read=p.refresh();
  if(mode==='unload'){p.onUnload();p.setData=()=>{writes++;};}
  else await p.refresh();
  if(mode==='old-failure')reject(Error('old error'));else resolve([]);
  await read;
  if(mode==='unload')assert.equal(writes,0);
  else {assert.equal(p.data.reviews[0].reviewReply,'最新回复');assert.equal(p.data.loadError,'');}
 }
});
test('离页后的回复结果不清草稿、不刷新或提示',async t=>{
 for(const failed of [false,true]){
  const p=page();let resolve,reject,writes=0,reads=0;
  global.wx={showToast:()=>assert.fail('离页后提示')};
  t.mock.method(cloud,'transitionOrder',()=>new Promise((yes,no)=>{resolve=yes;reject=no;}));
  const request=p.replyCloud(p.data.reviews[0],'保留的草稿');p.onUnload();
  p.setData=()=>{writes++;};p.refresh=()=>{reads++;};
  if(failed)reject(Object.assign(Error('conflict'),{code:'VERSION_CONFLICT'}));else resolve({});
  await request;assert.equal(writes,0);assert.equal(reads,0);
 }
});
test('公开回复弹窗取消、离页或原评价已更新不提交',()=>{
 for(const state of ['cancel','unloaded','changed','current']){
  const p=page();p.cloudMode=true;let modal,calls=0;
  global.wx={showModal:value=>{modal=value;},showToast(){}};
  p.replyCloud=()=>{calls++;};p.reply(event('a'));
  if(state==='unloaded')p.onUnload();
  if(state==='changed')p.data.reviews[0]={id:'a',version:4,reviewReply:'已发布'};
  modal.success({confirm:state!=='cancel'});
  assert.equal(calls,state==='current'?1:0);
 }
});
test('展开单条回复，切换与收起保留各自草稿',()=>{
 const p=page();p.toggleReply(event('a'));assert.equal(p.data.editingReplyId,'a');
 p.toggleReply(event('b'));assert.equal(p.data.editingReplyId,'b');
 p.toggleReply(event('b'));assert.equal(p.data.editingReplyId,'');assert.equal(p.data.drafts.a,'保留的草稿');
});
test('已回复、无效条目与请求中不能切换编辑对象',()=>{
 const p=page();p.toggleReply(event('done'));p.toggleReply(event('missing'));assert.equal(p.data.editingReplyId,'');
 p.data.pendingId='a';p.toggleReply(event('b'));assert.equal(p.data.editingReplyId,'');
});
test('发布失败保留草稿，成功仍使用原订单版本和服务端动作',async()=>{
 const original=cloud.transitionOrder;global.wx={showToast(){}};
 try {
  const p=page();p.data.editingReplyId='a';cloud.transitionOrder=async()=>{throw new Error('offline');};
  await p.replyCloud(p.data.reviews[0],'保留的草稿');assert.equal(p.data.drafts.a,'保留的草稿');assert.equal(p.data.pendingId,'');assert.equal(p.data.editingReplyId,'a');
  let call;cloud.transitionOrder=async(...args)=>{call=args;};await p.replyCloud(p.data.reviews[0],'保留的草稿');
  assert.deepEqual(call,['a',3,'PROVIDER_REPLIES_REVIEW',{reviewReply:'保留的草稿'}]);assert.equal(p.data.drafts.a,'');
 } finally { cloud.transitionOrder=original;delete global.wx; }
});
