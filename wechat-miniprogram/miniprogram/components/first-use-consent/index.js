const performance = require('../../utils/screen-performance');
const KEY='amFirstUseLocationChoiceV1';
Component({
 data:{visible:false,busy:false,error:''},
 lifetimes:{attached(){this.alive=true;let choice;try{choice=wx.getStorageSync(KEY);}catch(_){}const visible=!choice;this.setData({visible});const pages=typeof getCurrentPages==='function'?getCurrentPages():[];if(visible&&pages[pages.length-1]?.route==='pages/discover/index'&&wx.hideTabBar){this.tabBarHidden=true;wx.hideTabBar({animation:false});}},detached(){this.alive=false;if(this.tabBarHidden&&wx.showTabBar)wx.showTabBar({animation:false});}},
 methods:{
  noop(){},
  finish(choice){try{wx.setStorageSync(KEY,choice);}catch(_){/* Remembering the choice is optional; the current user action still completes. */}if(this.tabBarHidden&&wx.showTabBar){this.tabBarHidden=false;wx.showTabBar({animation:false});}if(this.alive){this.setData({visible:false,busy:false});this.triggerEvent('complete',{choice});}},
  manual(){if(!this.data.busy)this.finish('manual');},
  privacy(){if(wx.openPrivacyContract)wx.openPrivacyContract({fail:()=>{if(this.alive)this.setData({error:'暂时无法打开隐私指引，请稍后重试'});}});},
  agreement(){wx.navigateTo({url:'/pages/account-notice/index'});},
  async authorize(){
   if(!this.alive||this.data.busy)return;this.setData({busy:true,error:''});
   const app=getApp(),revision=app.sessionRevision,owner=app.globalData.account?.id;
   const current=()=>this.alive&&app.sessionRevision===revision&&app.globalData.account?.id===owner;
   try{
    if(!wx.getFuzzyLocation||!wx.requirePrivacyAuthorize)throw Error('unsupported');
    const privacyTiming=performance.begin('first-location-consent');
    await new Promise((resolve,reject)=>wx.requirePrivacyAuthorize({success:value=>{if(current())privacyTiming('accepted');resolve(value);},fail:error=>{if(current())privacyTiming('failed');reject(error);}}));
    if(!current())return;
    const coordinateTiming=performance.begin('location-coordinate');
    const location=await new Promise((resolve,reject)=>wx.getFuzzyLocation({type:'gcj02',success:value=>{if(current())coordinateTiming('success');resolve(value);},fail:error=>{if(current())coordinateTiming('failed');reject(error);}}));
    if(!current())return;
    if(!Number.isFinite(location.latitude)||!Number.isFinite(location.longitude))throw Error('invalid');
    app.globalData.pendingDiscoveryLocation={latitude:location.latitude,longitude:location.longitude};
    this.finish('located');
   }catch(_){if(current())this.setData({error:'未获取到位置，你也可以手动选择城市。'});}
   finally{if(this.alive&&this.data.busy)this.setData({busy:false});}
  }
 }
});
