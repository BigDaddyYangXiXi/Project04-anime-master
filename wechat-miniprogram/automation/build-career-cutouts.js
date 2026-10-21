// Preserve every source pixel: transparent SVG clips only the existing square background.
const fs=require('node:fs'),path=require('node:path');
const dir=path.resolve(__dirname,'../miniprogram/assets/careers');
const masks={
 zhuangniang:'<ellipse cx="89" cy="77" rx="57" ry="57"/><path d="M30 54Q9 51 8 76Q8 105 50 130Q105 160 148 129L147 114Q110 142 56 114Q13 86 33 60Z"/><ellipse cx="135" cy="19" rx="8" ry="10"/><ellipse cx="17" cy="46" rx="6" ry="8"/>',
 maoniang:'<path d="M27 75Q10 63 29 47Q29 28 51 28Q64 12 84 25Q108 20 119 39Q146 46 147 74Q155 98 137 115Q137 142 108 148Q78 156 54 144Q31 142 27 125Q9 131 11 115Q-2 101 17 88Q4 72 27 75Z"/><ellipse cx="139" cy="17" rx="8" ry="10"/><ellipse cx="147" cy="39" rx="4" ry="6"/>',
 sheying:'<ellipse cx="78" cy="82" rx="66" ry="60"/><path d="M14 29L22 41L34 45L23 53L20 66L10 52L2 48L12 43Z"/><ellipse cx="135" cy="18" rx="9" ry="11"/>',
 houqi:'<ellipse cx="94" cy="72" rx="56" ry="60"/><path d="M11 94L21 94L20 84L37 91L38 77L88 94L88 143L75 143L72 150L10 129Z"/><ellipse cx="31" cy="32" rx="11" ry="14"/><ellipse cx="49" cy="16" rx="5" ry="7"/><ellipse cx="136" cy="128" rx="16" ry="22"/>'
};
for(const [name,mask] of Object.entries(masks)){
 const original=fs.readFileSync(path.join(dir,name+'.png')).toString('base64');
 fs.writeFileSync(path.join(dir,name+'-cutout.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="152" height="152" viewBox="0 0 152 152"><defs><clipPath id="character">${mask}</clipPath></defs><image width="152" height="152" clip-path="url(#character)" href="data:image/png;base64,${original}"/></svg>`);
}
console.log('四种原图保持不变；生成透明轮廓 SVG。');
