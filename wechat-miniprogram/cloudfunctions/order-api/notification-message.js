// Internal SDK payload builder. The caller must first establish send eligibility.
// Official contract: /miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage
const TEMPLATE_ID = 'x5-tvzV9SaOPUjOLPT_lZBpqWnfCYKFU1LYI-JsqDGQ';
const STAGE_TEXT = Object.freeze({
  REQUESTED: '待回应', SUPPLEMENT_REQUESTED: '待补充', SUPPLEMENTED: '已补充',
  CONTACTING: '沟通中', NDA_BUYER_PENDING: '待签协议', NDA_PROVIDER_PENDING: '待签协议',
  BUYER_FINAL_CONFIRM: '待确认', IN_PRODUCTION: '制作中', REVISION_REQUESTED: '修改中',
  DELIVERY_PENDING: '待验收', COMPLETED: '已完成', DECLINED: '未达成'
});

function buildNotificationMessage(candidate, miniprogramState) {
  if (!candidate || !/^ord_[a-f0-9]{32}$/.test(candidate.orderId || '')
    || !Object.hasOwn(STAGE_TEXT, candidate.stage)
    || !['BUYER', 'PROVIDER'].includes(candidate.recipientRole)
    || typeof candidate.recipientOpenId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(candidate.recipientOpenId)
    || !['developer', 'trial', 'formal'].includes(miniprogramState)) {
    throw Object.assign(new Error('NOTIFICATION_MESSAGE_INVALID'), { code: 'NOTIFICATION_MESSAGE_INVALID' });
  }
  const page = candidate.recipientRole === 'PROVIDER'
    ? (candidate.stage === 'NDA_PROVIDER_PENDING' ? 'provider-task' : 'provider-request')
    : candidate.stage === 'DELIVERY_PENDING' ? 'fulfillment'
      : ['IN_PRODUCTION', 'REVISION_REQUESTED', 'COMPLETED'].includes(candidate.stage) ? 'order-detail' : 'booking-status';
  return {
    touser: candidate.recipientOpenId,
    templateId: TEMPLATE_ID,
    page: `pages/${page}/index?id=${candidate.orderId}`,
    miniprogramState,
    lang: 'zh_CN',
    data: {
      // Keep all 32 identifier digits; the internal ord_ prefix exceeds the template limit.
      character_string1: { value: candidate.orderId.slice(4) },
      phrase2: { value: STAGE_TEXT[candidate.stage] },
      // Private requirement titles and contact data must never appear on a notification card.
      thing3: { value: '服务预约' }
    }
  };
}

// Only an explicit documented channel response is definitive. Network exceptions and
// undocumented/malformed replies remain UNKNOWN, and never authorize automatic resending.
function notificationOutcome(reply) {
  if (reply && reply.errcode === 0) return 'ACKNOWLEDGED';
  if (reply && [40001, 40003, 40014, 40037, 43101, 43107, 43108, 45168, 47003].includes(reply.errcode)) return 'REJECTED';
  return 'UNKNOWN';
}

module.exports = { TEMPLATE_ID, buildNotificationMessage, notificationOutcome };
