const cloudCall = require('../utils/cloud-call');
const localPreview = require('../utils/local-preview');
async function call(data) {
  localPreview.assertCloudAllowed();
  const response = await cloudCall.call(wx, { name: 'support-api', data });
  if (!response?.result?.ok) throw Object.assign(new Error('申请服务暂不可用'), { code: response?.result?.error?.code || 'SUPPORT_UNAVAILABLE' });
  return response.result.data;
}
function key() { return 'support-' + Date.now() + '-' + Math.random().toString(36).slice(2, 14); }
async function withImages(record) {
  const images = record.attachments || [];
  if (!images.length) return record;
  try {
    const urls = await require('./cloud-catalog').resolveFileIds(images.map(i => i.fileId));
    return { ...record, attachments: images.map(image => ({ ...image, url: urls[image.fileId] || '' })) };
  } catch (_) { return { ...record, attachments: images.map(image => ({ ...image, url: '' })) }; }
}
module.exports = { call, key, withImages };
