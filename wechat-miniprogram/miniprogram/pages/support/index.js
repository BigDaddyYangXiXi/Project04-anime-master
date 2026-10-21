const support = require('../../services/cloud-support');
const catalog = require('../../services/cloud-catalog');
const { chooseWorkMedia } = require('../../utils/work-media-picker');
const labels = { FEEDBACK: '问题反馈', PHONE: '手机号更正申请', PRIVACY: '个人信息申请', CANCEL: '注销申请' };
const statuses = { PENDING: '待受理', PROCESSING: '处理中', REPLIED: '已回复', CLOSED: '已结束', WITHDRAWN: '已撤回' };
function present(item) { return { ...item, title: labels[item.kind], statusText: statuses[item.status] || '待核对', dateText: new Date(item.createdAt).toLocaleDateString('zh-CN'), events: item.events.map(e => ({ ...e, dateText: new Date(e.time).toLocaleString('zh-CN'), actorText: e.actor === 'SUPPORT' ? '处理回复' : '我的提交' })) }; }
Page({
  data: { navWorkspace: 'buyer', title: '问题反馈', mode: 'form', kind: 'FEEDBACK', description: '', orderId: '', guide: '', items: [], record: null, supplement: '', error: '', loading: false, pending: false, unknown: false, mutationUnknown: false, ready: false, cursor: null, images: [], uploading: false },
  onLoad(options = {}) { this.setData({ navWorkspace: wx.getStorageSync('animeMasterRole') === 'provider' ? 'provider' : 'buyer' });
    this.owner = getApp().globalData.account?.id;
    const kind = labels[options.kind] ? options.kind : 'FEEDBACK';
    this.recordId = options.id || '';
    if (this.recordId) {
      const saved = wx.getStorageSync('support-operation:' + this.owner + ':' + this.recordId);
      if (saved?.owner === this.owner && saved.id === this.recordId) {
        this.mutation = saved.operation;
        this.setData({ mutationUnknown: true, supplement: saved.operation.description || '' });
      }
    }
    this.setData({ kind, title: options.mode === 'list' ? '我的申请与反馈' : labels[kind], mode: this.recordId ? 'detail' : options.mode === 'list' ? 'list' : 'form', guide: options.guide || '' });
    this.draftKey = 'support-draft:' + this.owner + ':' + kind;
    const draft = wx.getStorageSync(this.draftKey);
    if (draft?.owner === this.owner && draft.kind === kind && this.data.mode === 'form') {
      this.requestKey = draft.key;
      this.setData({ description: draft.description, orderId: draft.orderId, guide: draft.guide, images: (draft.assetIds || []).map(assetId => ({ assetId, status: 'READY', statusText: '已附加' })), unknown: true });
    }
  },
  onShow() { this.active = true; if (!this.current()) { this.pendingImages = null; this.setData({ images: [], record: null, items: [], description: '', supplement: '', orderId: '', uploading: false }); return; } this.setData({ pending: false }); if (this.pendingImages) { this.setData(this.pendingImages); this.pendingImages = null; } if (this.data.mode !== 'form') this.load(); },
  onHide() { this.active = false; this.generation = (this.generation || 0) + 1; },
  onUnload() { this.closed = true; this.onHide(); },
  current() { return this.active && this.owner && this.owner === getApp().globalData.account?.id; },
  input(event) { const field = event.currentTarget.dataset.field; if (['description', 'supplement', 'orderId'].includes(field) && !this.data.pending && !this.data.unknown && !this.data.mutationUnknown) this.setData({ [field]: event.detail.value }); },
  async load(event) {
    if (!this.current() || this.data.pending) return;
    const more = event?.currentTarget?.dataset.more === '1', generation = this.generation = (this.generation || 0) + 1;
    const cursor = more ? this.data.cursor : null;
    if (more && !cursor) return;
    this.setData({ loading: true, error: '' });
    try {
      let result = await support.call(this.data.mode === 'detail' ? { action: 'get', id: this.recordId } : { action: 'list', cursor });
      if (this.data.mode === 'detail') result = await support.withImages(result);
      if (!this.current() || generation !== this.generation) return;
      if (this.data.mode === 'detail' && this.mutation && result.events.some(e => e.id === this.mutation.idempotencyKey && e.actor === 'USER')) { this.clearMutation(); this.setData({ supplement: '' }); }
      this.setData(this.data.mode === 'detail' ? { record: present(result), ready: true, loading: false, title: labels[result.kind] } : { items: (more ? this.data.items : []).concat(result.items.map(present)), cursor: result.cursor, loading: false, ready: true });
    } catch (_) { if (this.current() && generation === this.generation) this.setData({ loading: false, error: '暂时未能读取申请，请重试或联系开发者。' }); }
  },
  async submit() {
    if (!this.current() || this.data.pending || this.data.uploading) return;
    if (this.data.images.some(i => i.status !== 'READY')) return this.setData({ error: '图片审核未完成，请刷新审核状态或移除未通过图片。' });
    const generation = this.generation;
    if (this.data.description.trim().length < 10) return this.setData({ error: '请用至少10个字说明问题、申请目的或需要更正的内容。' });
    this.requestKey = this.requestKey || support.key();
    const payload = { kind: this.data.kind, description: this.data.description.trim(), orderId: this.data.orderId.trim(), guide: this.data.guide, assetIds: this.data.images.map(i => i.assetId) };
    try { wx.setStorageSync(this.draftKey, { ...payload, owner: this.owner, key: this.requestKey }); }
    catch (_) { return this.setData({ error: '无法保存提交记录，请清理设备存储后重试。本次未发送新的请求，填写内容已保留。' }); }
    this.setData({ pending: true, unknown: true, error: '' });
    try {
      const result = await support.withImages(await support.call({ action: 'create', idempotencyKey: this.requestKey, ...payload }));
      if (!this.current() || generation !== this.generation) return;
      wx.removeStorageSync(this.draftKey);
      this.recordId = result.id;
      this.setData({ pending: false, unknown: false, mode: 'detail', record: present(result), ready: true, description: '' });
    } catch (error) {
      if (!this.current() || generation !== this.generation) return;
      const invalid = ['VALIDATION_ERROR', 'ORDER_NOT_OWNED', 'ATTACHMENT_NOT_READY'].includes(error.code);
      if (invalid) wx.removeStorageSync(this.draftKey);
      this.setData({ pending: false, unknown: !invalid, error: invalid ? '请核对说明、本人订单编号及图片审核状态后重试。' : '提交结果尚未确认。重试会核对同一份申请，不会重新创建；也可联系开发者。' });
    }
  },
  async append(event) {
    if (!this.current() || this.data.pending || this.data.mutationUnknown || !this.data.record) return;
    const withdraw = event.currentTarget.dataset.action === 'withdraw';
    if (withdraw) { const version = this.data.record.version, generation = this.generation; return wx.showModal({ title: '撤回注销申请', content: '撤回后保留账号，已提交的申请记录仍可查看。', success: ({ confirm }) => { if (confirm && this.current() && generation === this.generation && version === this.data.record?.version) this.mutate('withdraw', ''); } }); }
    const value = this.data.supplement.trim();
    if (!value) return this.setData({ error: '请填写需要补充的信息。' });
    return this.mutate('append', value);
  },
  async mutate(action, description) {
    if (!this.current() || this.data.pending || !this.data.record) return;
    const generation = this.generation = (this.generation || 0) + 1;
    const hadMutation = !!this.mutation;
    this.mutation = this.mutation || { action, description, idempotencyKey: support.key(), expectedVersion: this.data.record.version };
    try { wx.setStorageSync('support-operation:' + this.owner + ':' + this.recordId, { owner: this.owner, id: this.recordId, operation: this.mutation }); }
    catch (_) { if (!hadMutation) this.mutation = null; return this.setData({ error: '无法保存操作记录，请清理设备存储后重试。本次未发送新的请求。' }); }
    this.setData({ pending: true, mutationUnknown: true, loading: false, error: '' });
    try {
      const result = await support.withImages(await support.call({ ...this.mutation, id: this.recordId }));
      if (!this.current() || generation !== this.generation) return;
      this.clearMutation();
      this.setData({ pending: false, record: present(result), supplement: '' });
    } catch (e) {
      if (!this.current() || generation !== this.generation) return;
      this.setData({ pending: false });
      if (['VERSION_CONFLICT', 'REQUEST_CLOSED', 'VALIDATION_ERROR', 'REQUEST_LIMIT'].includes(e.code)) { this.clearMutation(); await this.load(); if (this.current()) this.setData({ error: '本次未提交，申请状态或内容需要重新核对。补充文字已保留。' }); }
      else this.setData({ error: '上次操作结果尚未确认，请点击核对上次操作。确认前暂不能修改或发起其他操作。' });
    }
  },
  clearMutation() { wx.removeStorageSync('support-operation:' + this.owner + ':' + this.recordId); this.mutation = null; this.setData({ mutationUnknown: false }); },
  retryMutation() { if (this.mutation) return this.mutate(this.mutation.action, this.mutation.description); },
  open(event) { wx.navigateTo({ url: '/pages/support/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) }); },
  chooseImages() {
    if (!this.current() || this.data.pending || this.data.unknown || this.data.uploading || this.data.images.length >= 3) return;
    chooseWorkMedia({ count: 3 - this.data.images.length, success: result => this.uploadImages(result.tempFiles || []) });
  },
  async uploadImages(files) {
    if (this.closed || this.owner !== getApp().globalData.account?.id || this.data.uploading) return;
    this.setData({ uploading: true, error: '' });
    const images = this.data.images.slice(); let error = '';
    try { for (const file of files.slice(0, 3 - images.length)) { const image = await catalog.uploadImage(file, 'SUPPORT_IMAGE'); if (this.closed || this.owner !== getApp().globalData.account?.id) return; images.push({ ...image, statusText: image.status === 'READY' ? '可提交' : image.status === 'REJECTED' ? '审核未通过' : '审核中' }); } }
    catch (_) { error = '部分图片未上传成功；已上传图片已保留，请重试。'; }
    if (this.closed || this.owner !== getApp().globalData.account?.id) return;
    const patch = { images, uploading: false, error };
    if (this.active) this.setData(patch); else this.pendingImages = patch;
  },
  async refreshImages() {
    if (!this.current() || this.data.uploading || this.data.pending || this.data.unknown) return;
    this.setData({ uploading: true, error: '' });
    try {
      const images = await Promise.all(this.data.images.map(async image => { const result = await catalog.getImageStatus(image.assetId); return { ...image, status: result.status, statusText: result.status === 'READY' ? '可提交' : result.status === 'REJECTED' ? '审核未通过' : '审核中' }; }));
      if (this.current() && !this.closed) this.setData({ images, uploading: false });
      else if (!this.closed && this.owner === getApp().globalData.account?.id) this.pendingImages = { images, uploading: false };
    } catch (_) { if (this.current() && !this.closed) this.setData({ uploading: false, error: '审核状态读取失败，请重试。' }); else if (!this.closed && this.owner === getApp().globalData.account?.id) this.pendingImages = { uploading: false }; }
  },
  removeImage(event) { if (!this.data.pending && !this.data.unknown && !this.data.uploading) this.setData({ images: this.data.images.filter(i => i.assetId !== event.currentTarget.dataset.id) }); },
  previewDraft(event) { if (!this.current()) return; const image = this.data.images.find(i => i.assetId === event.currentTarget.dataset.id); if (!image?.preview) return wx.showToast({ title: '本地预览暂不可用', icon: 'none' }); wx.previewImage({ current: image.preview, urls: this.data.images.map(i => i.preview).filter(Boolean) }); },
  imageUnavailable(event) {
    if (!this.current()) return;
    const id = event.currentTarget.dataset.id;
    if (this.data.mode === 'form') this.setData({ images: this.data.images.map(i => i.assetId === id ? { ...i, preview: '' } : i) });
    else if (this.data.record) this.setData({ record: { ...this.data.record, attachments: this.data.record.attachments.map(i => i.assetId === id ? { ...i, url: '' } : i) } });
  },
  previewImage(event) { const image = this.data.record?.attachments?.find(i => i.assetId === event.currentTarget.dataset.id); if (!this.current()) return; if (!image?.url) return this.load(); wx.previewImage({ current: image.url, urls: this.data.record.attachments.map(i => i.url).filter(Boolean) }); },
  history() { wx.navigateTo({ url: '/pages/support/index?mode=list' }); },
  contact() { wx.navigateTo({ url: '/pages/help/index?contact=1' }); }
});
