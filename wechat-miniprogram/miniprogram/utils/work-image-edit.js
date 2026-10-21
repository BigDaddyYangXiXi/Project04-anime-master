// Source and display assets move together; rendering never changes the original.
const FIELDS = ['imagePreviews', 'imageAssetIds', 'mediaStatuses', 'sourceImagePreviews', 'sourceImageAssetIds', 'sourceMediaStatuses', 'watermarks'];
function prepare(work) {
  const out = { ...work };
  for (const key of FIELDS) out[key] = (work.imagePreviews || []).map((_, i) => {
    if (work[key] && work[key][i] != null) return work[key][i];
    const source = { sourceImagePreviews: 'imagePreviews', sourceImageAssetIds: 'imageAssetIds', sourceMediaStatuses: 'mediaStatuses' }[key];
    return source ? (work[source] || [])[i] || '' : key === 'watermarks' ? null : '';
  });
  return out;
}
function move(work, from, to) {
  const out = prepare(work), count = out.imagePreviews.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= count || to >= count) return work;
  for (const key of FIELDS) { const item = out[key].splice(from, 1)[0]; out[key].splice(to, 0, item); }
  return out;
}
function remove(work, index) {
  const out = prepare(work);
  for (const key of FIELDS) out[key].splice(index, 1);
  return { ...out, imageCount: out.imagePreviews.length };
}
function watermark(value) {
  if (!value || !value.enabled) return null;
  const text = String(value.text || '').trim();
  if (!text || text.length > 40) throw new Error('请填写1—40字的水印文字');
  return { enabled: true, text, position: ['bottom-right','bottom-left','top-right','top-left','center'].includes(value.position) ? value.position : 'bottom-right', size: Math.max(2, Math.min(6, Number(value.size) || 3)), opacity: Math.max(20, Math.min(90, Number(value.opacity) || 60)) };
}
async function render(page, src, options) {
  const spec = watermark(options);
  if (!spec) return src;
  const info = await new Promise((resolve, reject) => wx.getImageInfo({ src, success: resolve, fail: reject }));
  const canvas = await new Promise((resolve, reject) => page.createSelectorQuery().select('#watermark-canvas').fields({ node: true }).exec(result => result && result[0] && result[0].node ? resolve(result[0].node) : reject(new Error('图片处理暂不可用，请保留草稿后重试'))));
  const scale = Math.min(1, 2560 / Math.max(info.width, info.height));
  canvas.width = Math.round(info.width * scale); canvas.height = Math.round(info.height * scale);
  const image = canvas.createImage();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = info.path; });
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h); ctx.drawImage(image, 0, 0, w, h);
  let size = Math.min(w, h) * spec.size / 100;
  ctx.font = `${size}px sans-serif`;
  const width = ctx.measureText(spec.text).width;
  if (width > w * .9) { size *= w * .9 / width; ctx.font = `${size}px sans-serif`; }
  const pad = Math.min(w, h) * .04, center = spec.position === 'center';
  ctx.textAlign = center ? 'center' : spec.position.endsWith('right') ? 'right' : 'left';
  ctx.textBaseline = center ? 'middle' : spec.position.startsWith('top') ? 'top' : 'bottom';
  ctx.globalAlpha = spec.opacity / 100; ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#171514'; ctx.shadowBlur = size / 8;
  ctx.fillText(spec.text, center ? w / 2 : spec.position.endsWith('right') ? w - pad : pad, center ? h / 2 : spec.position.startsWith('top') ? pad : h - pad);
  ctx.globalAlpha = 1;
  return new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvas, fileType: 'jpg', quality: .92, success: result => resolve(result.tempFilePath), fail: reject }, page));
}
module.exports = { FIELDS, prepare, move, remove, watermark, render };
