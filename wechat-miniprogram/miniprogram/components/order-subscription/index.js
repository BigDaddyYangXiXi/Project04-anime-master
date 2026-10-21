const { requestOrderSubscription } = require('../../services/order-subscription');

Component({
  properties: { orderId: String },
  data: { pending: false, resultText: '' },
  lifetimes: { attached() { this.detached = false; }, detached() { this.detached = true; } },
  methods: {
    async subscribe() {
      if (this.data.pending || !/^ord_[a-f0-9]{32}$/.test(this.properties.orderId || '')) return;
      this.setData({ pending: true, resultText: '' });
      // Keep the native request in the original tap stack, before any await/network call.
      const result = await requestOrderSubscription(wx);
      if (this.detached) return;
      const messages = {
        accept: '本次订阅已同意', reject: '未订阅，不影响订单操作',
        ban: '通知已被关闭，可在小程序设置中调整', filter: '当前模板暂不可订阅',
        unavailable: '当前微信版本不支持，请更新微信后重试', failed: '订阅未完成，请重试'
      };
      this.setData({ pending: false, resultText: messages[result.status] || messages.failed });
    }
  }
});
