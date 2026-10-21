// Simulator-only fixtures. This file is outside the upload package.
const { makeOrder, CURRENT_BUYER_ID } = require('../miniprogram/data/v063-store');
const { allowed } = require('../miniprogram/data/order-machine');
const { stageLabels, providers } = require('../miniprogram/data/v063');
const catalog = require('../design-system/catalog.json');

function generate(now = new Date()) {
  const orders = [];
  const scenarios = [];
  const add = (page, label, role = 'buyer', query = {}, patch = null, calls = []) => {
    const entry = catalog.pages.find(row => row.route === `pages/${page}/index`);
    scenarios.push({ id: `S${String(scenarios.length + 1).padStart(3, '0')}`, page, pageTitle: entry ? entry.name || entry.title || page : page,
      label, role, query, patch, calls, kind: patch ? '界面状态注入；重新选择场景恢复' : '本地数据／页面原有交互' });
  };
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  function order(stage, patch = {}, career = '妆娘') {
    const index = orders.length;
    const result = makeOrder(`UI-${stamp}-${String(index + 1).padStart(3, '0')}`, '阿遥', stage, 0, career);
    const date = new Date(now); date.setDate(date.getDate() + (stage === 'COMPLETED' ? -7-index : ['DELIVERY_PENDING','REVISION_REQUESTED'].includes(stage) ? -1 : index+2));
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const advanced = ['NDA_BUYER_PENDING','NDA_PROVIDER_PENDING','BUYER_FINAL_CONFIRM','IN_PRODUCTION','REVISION_REQUESTED','DELIVERY_PENDING','COMPLETED'].includes(stage);
    const paid = ['IN_PRODUCTION','REVISION_REQUESTED','DELIVERY_PENDING','COMPLETED'].includes(stage);
    Object.assign(result, { buyerId: CURRENT_BUYER_ID, buyerUid: CURRENT_BUYER_ID,
      time: `${day.replace(/-/g, '/')} 10:00—12:00`, requestedAt: now.getTime() - 3600000,
      requirement: `星海来信 · 第${index + 1}组角色合作。需要双人近景与全身成片，保留服装纹理；交付12张精修图，含一轮约定范围内调整。`,
      reference: '星海来信 · 双人角色摄影', originalPrice: 1280 + index * 10, finalPrice: 1280 + index * 10,
      contact: {name:'阿遥',wechat:'ui_test_ayao',phone:''},
      communicationDone: advanced, timePlaceConfirmed: advanced, serviceScopeConfirmed: advanced, amountConfirmed: advanced,
      executable: advanced, ndaRequired: ['NDA_BUYER_PENDING','NDA_PROVIDER_PENDING'].includes(stage),
      buyerNdaSigned: stage === 'NDA_PROVIDER_PENDING', providerNdaSigned: false,
      buyerAgreementConfirmedAt: paid ? now.getTime() - 1200000 : null,
      paymentStatus: paid ? 'PAID' : 'UNPAID', paidAt: paid ? now.getTime() - 600000 : null,
      paymentTransactionId: paid ? `LOCAL-${stamp}-${index}` : '', paymentRequest: null,
      contactFirstCopiedAt: advanced || stage === 'CONTACTING' ? now.getTime() - 2400000 : null,
      progress: stage === 'COMPLETED' || stage === 'DELIVERY_PENDING' ? 100 : paid ? 45 : 0,
      supplementNote: ['SUPPLEMENT_REQUESTED','SUPPLEMENTED'].includes(stage) ? '请补充第二位角色的服装设定和拍摄地点。' : stage === 'DECLINED' ? '档期冲突，本次暂无法合作。' : '',
      revisionNote: stage === 'REVISION_REQUESTED' ? '第二张照片请降低背景亮度，并保留衣服的暗部细节。' : '',
      declinePhase: stage === 'DECLINED' ? 'request' : '', rating: 0, reviewText: '', reviewReply: ''
    });
    const provider=providers.find(p=>p.career===career);
    Object.assign(result,{providerId:provider.id,provider:provider.name,providerUid:provider.handle});
    if(career==='妆娘')result.requirement=`星海来信 · 第${index+1}组角色妆造。冷调男性角色，包含基础发型整理；需要兼顾近景肤质与全天持妆，现场确认妆面效果。`;
    result.requestedAt=Math.min(now.getTime()-3600000,date.getTime()-7*86400000);
    if(result.contactFirstCopiedAt)result.contactFirstCopiedAt=result.requestedAt+600000;
    if(paid){result.buyerAgreementConfirmedAt=result.requestedAt+1200000;result.paidAt=result.requestedAt+1800000;}
    result.bookingDraft = {...result.bookingDraft, providerId:provider.id,workId:provider.works[0].id,cityCode:'330100', date:day,startDate:day,endDate:day,startTime:'10:00',endTime:'12:00',note:result.requirement,contact:result.contact};
    result.serviceItems = [{id:provider.services[0].id,name:result.service,displayPrice:result.finalPrice,finalPrice:result.finalPrice}];
    result.bookingDraft.serviceIds=result.serviceItems.map(s=>s.id);
    Object.assign(result, patch); orders.push(result); return result;
  }
  const byStage = {};
  for (const stage of Object.keys(allowed)) {
    const row = byStage[stage] = order(stage);
    const buyerPage = ['IN_PRODUCTION','REVISION_REQUESTED','COMPLETED'].includes(stage) ? 'order-detail' : stage === 'DELIVERY_PENDING' ? 'fulfillment' : 'booking-status';
    add(buyerPage, stageLabels[stage] || stage, 'buyer', {id:row.id});
    add(stage === 'NDA_PROVIDER_PENDING' ? 'provider-task' : 'provider-request', stageLabels[stage] || stage, 'provider', {id:row.id});
  }
  for (const status of ['UNPAID','FAILED','VERIFYING','PAYMENT_REVIEW']) {
    const row=order('BUYER_FINAL_CONFIRM',{paymentStatus:status,buyerAgreementConfirmedAt:now.getTime()-60000});
    add('booking-status', {UNPAID:'合作已确认／待付款',FAILED:'付款失败／可重试',VERIFYING:'付款结果确认中',PAYMENT_REVIEW:'付款信息待核对'}[status], 'buyer',{id:row.id});
  }
  const onsite=order('DELIVERY_PENDING',{},'妆娘');add('fulfillment','现场服务验收','buyer',{id:onsite.id});
  const fileDelivery=order('DELIVERY_PENDING',{},'摄影');
  add('fulfillment','文件交付／填写修改意见','buyer',{id:fileDelivery.id,revision:'1'});
  for (const [label,patch] of [['待评价',{}],['已评价／待回复',{rating:4,reviewText:'沟通及时，构图和色彩符合约定。希望下次能更早给到选片。'}],['已评价／已回复',{rating:5,reviewText:'现场配合顺畅，成片细节保留得很好。',reviewReply:'谢谢认真反馈，下次会提前安排选片时间。'}]]) {
    const row=order('COMPLETED',patch);add('review',label,'buyer',{id:row.id});
  }
  add('review','尚未完成／不可评价','buyer',{id:byStage.IN_PRODUCTION.id});
  add('review','评分与长评草稿','buyer',{id:byStage.COMPLETED.id,draft:'1'});
  const defaults={ 'work-detail':{id:'w-mu-1'},'provider-detail':{id:1},'provider-schedule':{id:1},booking:{providerId:1},'booking-status':{id:byStage.REQUESTED.id},'order-detail':{id:byStage.IN_PRODUCTION.id},'provider-request':{id:byStage.REQUESTED.id},'provider-task':{id:byStage.NDA_PROVIDER_PENDING.id},fulfillment:{id:byStage.DELIVERY_PENDING.id},review:{id:byStage.COMPLETED.id},brief:{id:'UI-PROJECT-01'},'project-detail':{id:'UI-PROJECT-01'},'me-assets':{type:'liked'}};
  for(const entry of catalog.pages) {
    const page=entry.route.split('/')[1];
    for(const role of entry.roles.includes('provider') && entry.roles.includes('buyer') ? ['buyer','provider'] : [entry.roles[0]==='provider'?'provider':'buyer']) add(page,'完整内容',role,{...(defaults[page]||{}),...(role==='provider'&&['work-detail','provider-detail','provider-schedule'].includes(page)?{workspace:'provider'}:{}),...(page==='search-results'?{city:'杭州',cityCode:'330100',career:'妆娘'}:{})});
  }
  for(const state of ['login','register','loading','error','success']) add('auth',{login:'登录',register:'注册',loading:'检查登录状态',error:'授权后网络错误',success:'注册成功'}[state],'buyer',{state});
  add('auth','昵称缺失／协议未同意','buyer',{state:'register'},{fieldError:true,noticeError:true});
  add('auth','授权处理中','buyer',{state:'login'},{processing:true});
  for(const mode of ['works','people']) {
    add('discover',mode==='works'?'按作品浏览':'按服务方浏览','buyer',{mode});
    add('discover','搜索浮层 · '+mode,'buyer',{mode,overlay:'search'});
    add('discover','高级筛选 · '+mode,'buyer',{mode,overlay:'filter'});
    add('discover','无匹配结果 · '+mode,'buyer',{mode,q:'测试无匹配关键词星际鲸落'});
  }
  for(const mode of ['day','continuous','segments']) add('booking',{day:'全天预约',continuous:'连续时段预约',segments:'多个时段预约'}[mode],'buyer',{providerId:1,mode,fixture:'valid'});
  add('booking','结束时间早于开始时间','buyer',{providerId:1,invalid:'1'});
  add('booking','档期冲突','buyer',{providerId:1,conflict:'1',fixture:'valid'});
  add('booking','再次预约保留原资料','buyer',{repeatOrderId:byStage.DECLINED.id});
  for(const role of ['buyer','provider']) for(const group of ['booking','execution','history']) {
    add('orders',`订单分类 · ${{booking:'预约沟通',execution:'执行与验收',history:'历史订单'}[group]}`,role,{group});
    add('orders',`空订单分类 · ${{booking:'预约沟通',execution:'执行与验收',history:'历史订单'}[group]}`,role,{group,empty:'1'});
  }
  for(const page of ['projects','provider-calendar']) add(page,'已修改／可保存档期','provider',{changed:'1'});
  add('provider-reviews','没有评价','provider',{empty:'1'});
  add('provider-reviews','回复草稿展开','provider',{},null,[{method:'toggleReply',args:[{currentTarget:{dataset:{id:orders.find(o=>o.rating>0&&!o.reviewReply).id}}}]}]);
  for(const type of ['liked','followed']) add('me-assets',type==='liked'?'喜欢的作品':'关注的服务方','buyer',{type});
  for(const [label,patch] of [['未关注／未喜欢',{followed:false,liked:false}],['已关注／已喜欢',{followed:true,liked:true}],['关系操作请求中',{socialPending:true}]]) add('work-detail',label,'buyer',{id:'w-mu-1'},patch);
  for(const section of ['profile','works']) add('provider-profile',section==='profile'?'公开资料与服务编辑':'作品编辑','provider',{section,workId:'w-mu-1'});
  add('provider-profile','作品不足三件','provider',{twoWorks:'1'});
  add('provider-profile','新作品／尚未上传','provider',{section:'works'});
  add('provider-profile','服务编辑收起','provider',{},null,[{method:'toggleServiceEditor',args:[{currentTarget:{dataset:{id:'makeup'}}}]}]);
  add('provider-profile','关联作品选择层','provider',{},null,[{method:'openWorkPicker',args:[{currentTarget:{dataset:{index:0}}}]}]);
  add('project-detail','关联订单选择层','buyer',{id:'UI-PROJECT-01'},null,[{method:'addOrder',args:[]}]);
  add('project-detail','未关联订单','buyer',{id:'UI-PROJECT-01'},{linkedOrders:[],orderCount:0,total:0,ndaPending:0});
  add('search-results','搜索浮层','buyer',{overlay:'search',city:'杭州',career:'妆娘'});
  add('search-results','无匹配结果','buyer',{q:'测试无匹配关键词星际鲸落',city:'杭州',career:'妆娘'});
  add('provider-task','等待需求方签署','provider',{id:byStage.NDA_BUYER_PENDING.id});
  const signed=order('BUYER_FINAL_CONFIRM',{ndaRequired:true,buyerNdaSigned:true,providerNdaSigned:true});
  add('provider-task','双方已签署','provider',{id:signed.id});
  for(const page of ['provider-detail','work-detail','provider-schedule'])add(page,'服务方查看公开橱窗','provider',{...defaults[page],workspace:'provider'});
  const fundsRecords=[{id:'UI-FUND-01',orderId:byStage.IN_PRODUCTION.id,totalFen:byStage.IN_PRODUCTION.finalPrice*100,currency:'CNY',paidAt:now.getTime()-600000,status:'PAID'},
    {id:'UI-FUND-02',orderId:orders.find(o=>o.paymentStatus==='PAYMENT_REVIEW').id,totalFen:143000,currency:'CNY',paidAt:now.getTime()-300000,status:'PAID_REQUIRES_REVIEW'}];
  for(const [merchantStatus,label] of [['NOT_STARTED','未开通'],['PENDING','核验中'],['READY','已核验'],['SUSPENDED','资格暂不可用']])add('funds','收款资料／'+label,'provider',{},null,[{method:'renderResponse',args:[{records:fundsRecords,nextCursor:null,merchantStatus},false]}]);
  add('funds','记录翻页读取中','provider',{}, {loadingMore:true},[{method:'renderResponse',args:[{records:fundsRecords,nextCursor:'LOCAL-NEXT',merchantStatus:'READY'},false]}]);
  add('funds','记录翻页失败','provider',{}, {moreError:'更多记录读取失败，已显示的记录仍保留。'},[{method:'renderResponse',args:[{records:fundsRecords,nextCursor:'LOCAL-NEXT',merchantStatus:'READY'},false]}]);
  for(const [label,patch] of [['图片审核中',{hasPendingMedia:true,canPublish:false}],['图片审核未通过',{hasRejectedMedia:true,canPublish:false}],['保存处理中',{saving:true}]]) add('provider-profile',label,'provider',{},patch);
  // Common request states are included only where the actual template renders them.
  const fs=require('node:fs'),path=require('node:path');
  const keys=[['loading','loadError'],['cloudLoading','cloudError'],['catalogLoading','catalogError'],['dashboardLoading','dashboardError']];
  for(const entry of catalog.pages) {
    const page=entry.route.split('/')[1], source=fs.readFileSync(path.join(__dirname,'../miniprogram',entry.route+'.wxml'),'utf8');
    for(const [loading,error] of keys) if(source.includes('{{'+loading+'}}') && source.includes(error)) {
      const role=entry.roles[0]==='provider'?'provider':'buyer';
      const part={loading:'页面内容',cloudLoading:'橱窗资料',catalogLoading:'检索结果',dashboardLoading:'工作台'}[loading];
      add(page,'读取中 · '+part,role,defaults[page]||{},{[loading]:true,[error]:''});
      const emptyContent={};
      for(const name of ['order','project','provider','profile','work']) if(source.includes(`wx:elif="{{${name}}}"`))emptyContent[name]=null;
      add(page,'读取失败／重试 · '+part,role,defaults[page]||{},{...emptyContent,[loading]:false,[error]:'测试网络暂时中断，请重试。'});
    }
  }
  const projects=[{id:'UI-PROJECT-01',title:'星海来信 · 双人角色摄影',shortTitle:'星海来信',date:orders[0].bookingDraft.date,city:'杭州',cityCode:'330100',location:'杭州 · 测试摄影棚',description:'双人角色摄影项目，含摄影、妆造与交付验收。',targetImages:[],sourceOrderIds:orders.map(o=>o.id),bookingIds:orders.filter(o=>o.stage!=='DECLINED').slice(0,8).map(o=>o.id),briefSaved:true,completed:false,projectModelVersion:2,createdAt:now.getTime()}];
  for(const scene of scenarios)if(scene.page==='work-detail'&&scene.patch&&'liked' in scene.patch){scene.storage={'v063-followed-providers':scene.patch.followed?[1]:[],'anime-master-v063-liked-work-ids':scene.patch.liked?['w-mu-1']:[]};scene.patch=null;scene.kind='本地关系数据；详情与我的内容联动';}
  for(const scene of scenarios)if(scene.calls.some(call=>call.method==='renderResponse'))scene.kind='界面状态注入；重新选择场景恢复';
  return {version:1,generatedAt:now.toISOString(),orders,projects,scenarios};
}
module.exports={generate};
