function rectangle(width,height,x=50,y=50) {
  if (!(width>0 && height>0)) throw Error('无法读取图片尺寸');
  const cropWidth=Math.min(width,height*16/9),cropHeight=cropWidth*9/16;
  return {x:(width-cropWidth)*Math.max(0,Math.min(100,Number(x)||0))/100,y:(height-cropHeight)*Math.max(0,Math.min(100,Number(y)||0))/100,width:cropWidth,height:cropHeight};
}
async function render(page,src,x,y) {
  const info=await new Promise((resolve,reject)=>wx.getImageInfo({src,success:resolve,fail:reject}));
  const canvas=await new Promise((resolve,reject)=>page.createSelectorQuery().select('#banner-canvas').fields({node:true}).exec(result=>result?.[0]?.node?resolve(result[0].node):reject(Error('头图处理暂不可用'))));
  const r=rectangle(info.width,info.height,x,y);canvas.width=Math.min(1600,Math.round(r.width));canvas.height=Math.round(canvas.width*9/16);
  const image=canvas.createImage();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=info.path;});
  canvas.getContext('2d').drawImage(image,r.x,r.y,r.width,r.height,0,0,canvas.width,canvas.height);
  return new Promise((resolve,reject)=>wx.canvasToTempFilePath({canvas,fileType:'jpg',quality:.9,success:value=>resolve(value.tempFilePath),fail:reject},page));
}
module.exports={rectangle,render};
