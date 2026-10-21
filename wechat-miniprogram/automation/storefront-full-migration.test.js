const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { changes } = require('../miniprogram/data/storefront-changes');
const { rectangle } = require('../miniprogram/utils/banner-crop');
const catalog = require('../miniprogram/services/cloud-catalog');

test('历史公开内容经真实 DTO 往返补齐空字段，不产生虚假变更',()=>{
  const {normalizeDraft}=require('../cloudfunctions/provider-catalog-draft/draft-core');
  const historical=normalizeDraft({profile:{career:'妆娘',city:'杭州'},services:[{id:'s1',name:'妆造',priceFen:52000,unit:'次',description:'介绍'}],works:[{id:'w1',title:'案例',imageAssetIds:['img1']}],pinnedWorkIds:[]});
  const current=catalog.toServerDraft(catalog.toClientDraft(historical,{nickname:'作者'},[]));
  assert.deepEqual(changes(current,historical),[]);
  current.works[0].title='已修改';assert.equal(changes(current,historical)[0].action,'修改');
});

test('发布检查列出增改删，独立档期及生成编号不会造成重复发布', () => {
  const before = {profile:{bio:'简介',accepting:true},services:[{id:'s1',name:'妆造',priceFen:10000}],works:[{id:'w1',title:'旧案例'}]};
  const same = structuredClone(before); same.profile.accepting=false; same.works[0].code='AUTO';
  assert.deepEqual(changes(same,before),[]);
  same.services[0].priceFen=20000; same.services.push({id:'s2',name:'新服务'}); same.works=[];
  assert.deepEqual(changes(same,before).map(x=>[x.id,x.action]),[['s1','修改'],['s2','新增'],['w1','移除']]);
});
test('头图独立修改与须知修改归属各自入口', () => {
  const before={profile:{bio:'简介',bannerAssetId:'old',notice:'原须知'}};
  const after={profile:{bio:'简介',bannerAssetId:'new',notice:'新须知'}};
  assert.deepEqual(changes(after,before).map(x=>x.kind),['profile','notice']);
});
test('头图取景固定16比9且所有焦点均留在原图内', () => {
  for (const [w,h] of [[1200,1600],[3000,1000],[1600,900]]) for(const x of [-50,0,50,100,200])for(const y of [-50,0,50,100,200]) {
    const r=rectangle(w,h,x,y);
    assert.ok(Math.abs(r.width/r.height-16/9)<1e-8);
    assert.ok(r.x>=0 && r.y>=0 && r.x+r.width<=w+1e-8 && r.y+r.height<=h+1e-8);
  }
  assert.throws(()=>rectangle(0,100));
});
test('原图、取景图和位置在草稿往返后保留，不借用案例封面', () => {
  const server=catalog.toServerDraft({profile:{bannerAssetId:'crop',bannerSourceAssetId:'source',bannerFocusX:10,bannerFocusY:80},services:[],works:[]});
  const client=catalog.toClientDraft(server,{},[{assetId:'crop',tempFileURL:'crop-url'},{assetId:'source',tempFileURL:'source-url'}]);
  assert.equal(client.profile.bannerImage,'crop-url'); assert.equal(client.profile.bannerSourceImage,'source-url');
  assert.equal(client.profile.bannerFocusX,10); assert.equal(client.profile.bannerFocusY,80);
});
test('离开选择能继续、放弃或保存；切号后旧选择不能执行', () => {
  let page, choose, owner='a', saved=0, discarded=0;
  vm.runInNewContext(fs.readFileSync(__dirname+'/../miniprogram/pages/provider-profile/index.js','utf8'),{Page:p=>page=p,require:()=>({}),getApp:()=>({globalData:{account:{id:owner}}}),wx:{showActionSheet:options=>choose=options.success}});
  page.data={remoteDraftVersion:1,editorView:'profile'};
  page.chooseLeave('保存草稿并返回',()=>saved++,()=>discarded++);choose({tapIndex:1});assert.equal(saved+discarded,0);
  choose({tapIndex:0});assert.equal(saved,1);choose({tapIndex:2});assert.equal(discarded,1);
  owner='b';choose({tapIndex:0});assert.equal(saved,1);
});
