// Operator-token probe extension: metadata and HEAD only, never downloads bodies.
async function storageTiming(event, app, fetchHead = fetch) {
  if (typeof event.fileId !== 'string' || !/^cloud:\/\/cloudbase-d2g65rqbvee0bd978\.[^/]+\/.+/.test(event.fileId)
    || !['sdk', 'split'].includes(event.mode)) return { ok: false, code: 'INVALID_PROBE_INPUT' };
  const times = {}; let stage = 'database';
  const start = Date.now();
  try {
    let began = Date.now();
    const rows = await app.rdb().from('media_assets').select('id').eq('storage_key', event.fileId).limit(1);
    times.databaseMs = Date.now() - began;
    if (rows.error || rows.data?.length !== 1) return { ok: false, code: 'ASSET_NOT_FOUND', times };
    stage = 'metadata'; began = Date.now();
    if (event.mode === 'sdk') {
      const result = await app.getFileInfo({ fileList: [event.fileId] });
      times.metadataMs = Date.now() - began;
      const info = result.fileList?.find(file => file.fileID === event.fileId);
      return { ok: info?.code === 'SUCCESS', sizeBytes: Number(info?.size) || null, times, totalMs: Date.now() - start };
    }
    const result = await app.getTempFileURL({ fileList: [event.fileId] });
    times.urlMs = Date.now() - began;
    const info = result.fileList?.find(file => file.fileID === event.fileId);
    const url = new URL(info?.tempFileURL);
    if (info?.code !== 'SUCCESS' || url.protocol !== 'https:' || url.username || url.password) throw Error('URL_REJECTED');
    stage = 'head'; began = Date.now();
    const response = await fetchHead(encodeURI(info.tempFileURL), { method: 'HEAD', signal: AbortSignal.timeout(6000) });
    times.headMs = Date.now() - began;
    return { ok: response.ok, httpStatus: response.status, sizeBytes: Number(response.headers.get('content-length')) || null,
      times, totalMs: Date.now() - start };
  } catch { return { ok: false, code: 'STORAGE_TIMING_FAILED', stage, times, totalMs: Date.now() - start }; }
}
module.exports = { storageTiming };
