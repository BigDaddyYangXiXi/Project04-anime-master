const careers = [
 { name: '妆娘', letters: ['妆','娘'], asset: '/assets/careers/zhuangniang-cutout.svg' },
 { name: '毛娘', letters: ['毛','娘'], asset: '/assets/careers/maoniang-cutout.svg' },
 { name: '摄影', letters: ['摄','影'], asset: '/assets/careers/sheying-cutout.svg' },
 { name: '后期', letters: ['后','期'], asset: '/assets/careers/houqi-cutout.svg' }
];
function owner() { const app = typeof getApp === 'function' ? getApp() : null; return app && app.globalData.account && app.globalData.account.id; }
function valid(order) { return Array.isArray(order) && order.length === careers.length && new Set(order).size === careers.length && order.every(name => careers.some(item => item.name === name)); }
function read() { const id=owner(), saved=id && wx.getStorageSync('amCareerOrder:'+id); return valid(saved) ? saved.slice() : careers.map(item=>item.name); }
function save(order) { const id=owner(); if(!id || !valid(order)) throw Error('无法保存职业顺序'); wx.setStorageSync('amCareerOrder:'+id,order.slice()); }
function tabs(order=read()) { return order.map(name=>({...careers.find(item=>item.name===name)})); }
module.exports={careers,read,save,tabs,valid};
