const test=require('node:test'),assert=require('node:assert/strict');
const {groupsForKind,resetKind}=require('../miniprogram/data/discovery-controls');
const groups=[{group:'视觉风格',values:['古风','冷色']},{group:'价格区间',values:['低价','高价']}];
test('风格与价格分组互斥，重置不损失另一组条件',()=>{
 assert.deepEqual(groupsForKind(groups,'style'),[groups[0]]);
 assert.deepEqual(groupsForKind(groups,'price'),[groups[1]]);
 assert.deepEqual(resetKind(['古风','低价'],groups,'style'),['低价']);
 assert.deepEqual(resetKind(['古风','低价'],groups,'price'),['古风']);
});
