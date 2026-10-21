// The user-approved shared action contract supersedes rainbow secondary buttons.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../miniprogram');
const walk = dir => fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const aliases = ['primary-block','primary-button','secondary-block','secondary-button','danger-block','booking-button','save-button','success-action','empty-retry'];
let instances = 0;
for (const file of walk(root).filter(file=>file.endsWith('.wxml'))) {
  for (const match of fs.readFileSync(file,'utf8').matchAll(/class="([^"]*)"/g)) {
    const classes = match[1].split(/\s+/);
    if (!classes.some(name=>aliases.includes(name))) continue;
    assert.ok(classes.includes('am-action'), file + ' missing shared action');
    assert.equal(classes.filter(name=>/^am-action-(primary|secondary|danger)$/.test(name)).length,1, file + ' ambiguous action');
    instances++;
  }
}
assert.ok(instances > 0);
const shared = fs.readFileSync(path.join(root,'styles/actions.wxss'),'utf8');
assert.match(shared,/min-height:\s*var\(--am-touch-min\)/);
assert.match(shared,/font-size:\s*var\(--am-type-label\)/);
assert.ok(!/gradient|!important/.test(shared));
const app = fs.readFileSync(path.join(root,'app.wxss'),'utf8');
assert.match(app,/@import "styles\/actions.wxss"/);
assert.ok(!/page button\.secondary-/.test(app), 'retired override returned');
for(const file of walk(root).filter(file=>file.endsWith('.wxss')&&!file.endsWith('actions.wxss'))) {
  for(const match of fs.readFileSync(file,'utf8').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors=match[1].trim().split(',').map(s=>s.trim());
    if(!selectors.every(s=>/\.(primary-block|primary-button|secondary-block|secondary-button|danger-block|booking-button|save-button|success-action|empty-retry)(?:\.blocked|\[disabled\]|:active)?$/.test(s)))continue;
    assert.ok(!/(?:^|;)\s*(font-size|font-weight|line-height|background|color|border-radius|box-shadow)\s*:/.test(match[2]), file + ' duplicates action visual');
  }
}
console.log('Shared action audit passed: '+instances+' instances including compatibility pages.');
