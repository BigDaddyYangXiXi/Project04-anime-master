const preferences=require('../../data/home-preferences');
Page({
 data:{items:[],changed:false,error:''},
 onLoad(){this.owner=getApp().globalData.account?.id;this.original=preferences.read();this.apply(this.original);},
 apply(order){this.order=order.slice();this.setData({items:preferences.tabs(order),changed:JSON.stringify(order)!==JSON.stringify(this.original),error:''});},
 move(event){const index=Number(event.currentTarget.dataset.index),delta=Number(event.currentTarget.dataset.delta);if(!Number.isInteger(index)||![-1,1].includes(delta)||index+delta<0||index+delta>=this.order.length)return;const order=this.order.slice();[order[index],order[index+delta]]=[order[index+delta],order[index]];this.apply(order);},
 makeFirst(event){const index=Number(event.currentTarget.dataset.index);if(!Number.isInteger(index)||index<1||index>=this.order.length)return;const order=this.order.slice();const [item]=order.splice(index,1);this.apply([item,...order]);},
 save(){if(this.owner!==getApp().globalData.account?.id){this.setData({error:'账号已变化，请重新打开'});return;}try{preferences.save(this.order);wx.navigateBack({delta:1});}catch(_){this.setData({error:'保存失败，请重试'});}}
});
