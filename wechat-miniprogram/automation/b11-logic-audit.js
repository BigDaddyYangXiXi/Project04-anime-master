const assert = require("assert"); const storage = new Map(); let pageDefinition = null; let switchedTo = "";
let modalConfirm=true; global.wx = { getStorageSync(key){return storage.get(key);}, setStorageSync(key,value){storage.set(key,value);}, showModal(options){options.success({confirm:modalConfirm,cancel:!modalConfirm});}, switchTab({url}){switchedTo=url;}, reLaunch({url}){switchedTo=url;} }; global.Page=(definition)=>{pageDefinition=definition;};
const store=require("../miniprogram/data/v063-store"); require("../miniprogram/pages/review/index.js");
function clone(value){return JSON.parse(JSON.stringify(value));} storage.set(store.KEYS.orders,clone(store.initialOrders));
function createPage(options){const page={data:clone(pageDefinition.data)};Object.keys(pageDefinition).forEach((key)=>{if(key!=="data"&&typeof pageDefinition[key]==="function")page[key]=pageDefinition[key].bind(page);});page.setData=(patch)=>Object.assign(page.data,patch);page.onLoad(options);return page;}
const invalid=createPage({id:"AM-260821-05"}); assert.strictEqual(invalid.data.canReview,false);
const fresh=createPage({id:"AM-260824-08",audit:"1",fresh:"1"}); assert.strictEqual(fresh.data.canReview,true); assert.strictEqual(fresh.data.order.rating,0); assert.strictEqual(fresh.data.rating,0);
fresh.submit(); assert.strictEqual(store.findOrder("AM-260824-08").rating,5,"无评分时提交不得覆盖原订单");
fresh.chooseRating({currentTarget:{dataset:{value:4}}}); assert.strictEqual(fresh.data.rating,4);
fresh.updateText({detail:{value:"  沟通清楚，成片符合预期。  "}}); assert.strictEqual(fresh.data.textCount,16);
modalConfirm=false; fresh.submit(); assert.strictEqual(store.findOrder("AM-260824-08").rating,5,"取消确认不得覆盖原订单");
modalConfirm=true;
fresh.submit(); const saved=store.findOrder("AM-260824-08"); assert.strictEqual(saved.rating,4); assert.strictEqual(saved.reviewText,"沟通清楚，成片符合预期。"); assert.strictEqual(fresh.data.order.rating,4); assert.strictEqual(fresh.data.order.ratingText,"★★★★☆");
fresh.chooseRating({currentTarget:{dataset:{value:2}}}); assert.strictEqual(fresh.data.rating,0,"已评价后不得再次编辑");
fresh.goOrders(); assert.strictEqual(switchedTo,"/pages/orders/index");
const reply=createPage({id:"AM-260824-08",audit:"1",reply:"1"}); assert.ok(reply.data.order.reviewReply.includes("感谢"));
process.stdout.write("B11 logic audit: 15 assertions passed\n");
