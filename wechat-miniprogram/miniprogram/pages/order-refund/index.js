const orders = require('../../services/cloud-orders');
const refunds = require('../../services/cloud-refunds');
const drafts = require('../../data/refund-draft');
const labels = { REQUESTED:'待审核', APPROVED:'审核通过', REJECTED:'申请未通过', SUBMITTING:'退款处理中', PROCESSING:'退款处理中', SUCCESS:'退款成功', CLOSED:'退款已关闭', ABNORMAL:'退款待核对' };
const owner = () => getApp().globalData.account?.id;
const money = fen => (fen / 100).toFixed(2);

Page({
  data: { order:null, canApply:false, amount:'', reason:'', draftState:'', records:[], nextCursor:null, ready:false, historyReady:false, busy:false, error:'', loadError:'', historyError:'' },
  onLoad(options) {
    this.orderId = options.id; this.accountId = owner(); this.sessionRevision = getApp().sessionRevision;
    this.setData({navWorkspace:wx.getStorageSync('animeMasterRole') === 'provider' ? 'provider' : 'buyer'});
  },
  onShow() {
    if (!this.current()) { this.setData({order:null, records:[], amount:'', reason:'', ready:false, error:'账号已变化，请返回订单重新进入。'}); return; }
    this.load();
  },
  onUnload() { this.unloaded = true; },
  current() { return !this.unloaded && Boolean(this.accountId) && owner() === this.accountId && getApp().sessionRevision === this.sessionRevision; },
  async load() {
    if (this.loading || this.data.busy || !this.current()) return;
    this.loading = true;
    this.setData({loadError:'', ...(!this.data.ready ? {error:''} : {})});
    try {
      const order = await orders.getOrder(this.orderId);
      if (!this.current()) return;
      if (!['BUYER','PROVIDER'].includes(order.viewerRole) || !order.cloudOrder || order.paymentStatus !== 'PAID'
        || !/^[a-f0-9]{32}$/.test(order.paymentId || '') || !Number.isSafeInteger(order.amountFen) || order.amountFen <= 0) {
        this.setData({order:null, canApply:false, ready:false, error:'这笔订单暂不可查看退款。'});
        return;
      }
      const previous=this.data.order;
      const preserveInputs=this.data.canApply && order.viewerRole === 'BUYER' && previous
        && ['id','version','stage','paymentId'].every(key=>previous[key]===order[key])
        && !['UNKNOWN','ACKNOWLEDGED'].includes(this.data.draftState);
      this.setData({order, navWorkspace:order.viewerRole === 'PROVIDER' ? 'provider' : 'buyer', canApply:order.viewerRole === 'BUYER' && order.stage !== 'COMPLETED', totalText:money(order.amountFen), ready:true,
        ...(preserveInputs ? {} : {amount:'', reason:'', draftState:''})});
      if (this.data.canApply && !preserveInputs) this.restoreDraft();
      await this.loadRecords(false);
    } catch (_) {
      if (this.current()) this.setData(this.data.ready
        ? {loadError:'订单信息刷新失败，已保留当前输入，请重试。'}
        : {error:'订单信息暂不可用，请重试。', ready:false});
    } finally { this.loading = false; }
  },
  restoreDraft() {
    const draft = drafts.read(this.orderId);
    this.setData({draftState:draft?.state || '', amount:draft ? money(draft.amountFen) : '', reason:draft?.reason || ''});
  },
  async loadRecords(append) {
    if (this.historyLoading || !this.current()) return;
    this.historyLoading = true;
    this.setData({historyError:''});
    try {
      const result = await refunds.listRefunds(this.orderId, append ? this.data.nextCursor : null);
      if (!this.current()) return;
      const rows = result.records.map(row => ({...row, amountText:money(row.amountFen), statusText:labels[row.status]}));
      const records = append ? [...this.data.records, ...rows] : rows;
      this.setData({records:records.filter((row,index) => records.findIndex(item => item.refundId === row.refundId) === index), nextCursor:result.nextCursor, historyReady:true});
    } catch (_) {
      if (this.current()) this.setData({historyError:'退款记录暂不可用，请重试。'});
    } finally { this.historyLoading = false; }
  },
  refreshRecords() { return this.loadRecords(false); },
  moreRecords() { if (this.data.nextCursor) return this.loadRecords(true); },
  inputAmount(event) { if (!this.data.busy && !['UNKNOWN','ACKNOWLEDGED'].includes(this.data.draftState)) this.setData({amount:event.detail.value, error:''}); },
  inputReason(event) { if (!this.data.busy && !['UNKNOWN','ACKNOWLEDGED'].includes(this.data.draftState)) this.setData({reason:event.detail.value, error:''}); },
  async submit() {
    if (!this.data.canApply || this.data.busy || !this.data.ready || !this.current() || this.data.draftState === 'ACKNOWLEDGED') return;
    let refreshCompleted = false;
    this.setData({busy:true, error:''});
    try {
      if (this.data.draftState !== 'UNKNOWN') {
        const text = this.data.amount.trim(), reason = this.data.reason.trim();
        const parts = text.split('.');
        const amountFen = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2,'0'));
        const reasonBytes = Array.from(reason).reduce((sum,char) => sum + (char.codePointAt(0) <= 127 ? 1 : char.codePointAt(0) <= 2047 ? 2 : char.codePointAt(0) <= 65535 ? 3 : 4), 0);
        if (!/^\d+(\.\d{1,2})?$/.test(text) || !Number.isSafeInteger(amountFen) || amountFen <= 0 || amountFen > this.data.order.amountFen) {
          this.setData({error:'请填写有效金额，最多两位小数，且不超过实付金额。'}); return;
        }
        if (!reason || reasonBytes > 80) { this.setData({error:'请简要填写退款原因（纯中文最多26字）。'}); return; }
        drafts.save({orderId:this.orderId, paymentId:this.data.order.paymentId, amountFen, reason});
      }
      await drafts.submit(this.orderId);
      if (!this.current()) return;
      this.restoreDraft();
      await this.loadRecords(false);
    } catch (error) {
      if (!this.current()) return;
      try { this.restoreDraft(); } catch (_) { /* Keep the entered fields when local storage fails. */ }
      const message = {
        REFUND_ORDER_COMPLETED:'订单已验收完成，不支持普通退款申请；特殊争议请通过问题反馈提交。',
        REFUND_REQUEST_NOT_ENABLED:'退款申请暂未开放。', REFUND_AMOUNT_EXCEEDED:'金额超过剩余可申请额度，请核对已有退款记录。',
        REFUND_PAYMENT_NOT_READY:'付款状态待核对，暂不能申请退款。', CLOUD_UNAVAILABLE:'退款服务暂不可用。',
        REFUND_INPUT_INVALID:'请检查退款金额和原因。'
      }[error?.code];
      refreshCompleted = error?.code === 'REFUND_ORDER_COMPLETED';
      if (refreshCompleted) this.setData({canApply:false});
      this.setData({error:message || (this.data.draftState === 'UNKNOWN' ? '申请结果尚未确认。请核对原申请，勿另建重复申请。' : '申请未完成，请稍后重试。')});
    } finally {
      if (this.current()) {
        this.setData({busy:false});
        if (refreshCompleted) await this.load();
      }
    }
  },
  startNext() {
    if (!this.data.canApply || this.data.busy || !this.current() || this.data.draftState !== 'ACKNOWLEDGED') return;
    try { drafts.startNext(this.orderId); this.restoreDraft(); this.setData({error:''}); }
    catch (_) { this.setData({error:'请先确认上一笔申请的结果。'}); }
  }
});
