const fs=require('fs'),path=require('path');
const tokens=require('../../tokens.json');
const css=Object.entries(tokens).filter(([k])=>k.startsWith('color-')).map(([k,v])=>`--am-${k}:${v};`).join('');
fs.writeFileSync(path.join(__dirname,'tokens.css'),`:root{${css}}\n`);
