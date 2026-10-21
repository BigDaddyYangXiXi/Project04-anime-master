# 支付只读排障入口

从项目的 wechat-miniprogram 目录运行：

```powershell
node scripts/audit-company-payment-health.js
```

仅使用公司 CLI 的只读 SQL，先核对数据库名，再输出计数；不输出账号、订单编号、正文或密钥。最近一次结果保存在 `.artifacts/company-payment-health.json`。各查询并非同一数据库快照，计数可能重叠，不能直接相加或当作渠道对账。

| 指标 | 表示什么 | 后续处理边界 |
|---|---|---|
| receiptsRequiringReview | 已记录收款但付款身份、金额或订单状态需复核 | 保留原付款事实，核对签名通知／原交易查询与订单；不重新收款、不直接改成已支付 |
| unresolvedPrepayAttempts | 开始过预支付但尚未保存预支付编号 | 先查询原交易编号；不因超时另建付款单 |
| unfinishedRecovery | 原预支付恢复仍未完成 | 检查原编号查询和关单结果；不得把调用超时当作关单成功 |
| unpreparedAcceptedOrders | 已验收且留有结算意图，但还没有分账任务 | 核对已支付事实、费用快照、收款资格及争议拦截后准备原订单任务 |
| prepared / processing | 分账任务待提交／结果未决 | 检查执行权和原分账编号；processing 不等于服务方到账 |
| holdsAfterSettlementStarted | 退款／争议登记在分账开始标记之后 | 先核对分账实际结果，再进入人工处置；不能直接退款或清除互斥记录 |
| consumedRequestSignatures | 防重放许可消费记录总数 | 消费成功不等于微信收到请求，更不等于交易成功；不得为重试清除有效记录 |

该工具不发送告警、不自动退款、不关闭或修改订单，也不替代微信账单对账。告警负责人、值守频率、处理时限及保留期仍待确定。

2026-09-24 首次公司环境检查：全部计数为零，说明当前为空数据状态，不能据此证明真实支付链路健康或可上线。
