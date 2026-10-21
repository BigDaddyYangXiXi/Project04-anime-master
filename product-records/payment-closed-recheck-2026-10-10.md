# 微信支付当前关闭态复核（2026-10-10）

沿用既有只读公司CLI，执行 audit-company-payment-closed-deployment.js，对 payment-api、payment-notify、payment-refund-notify 分别加 --merchant-configured。三者均 ok=true：Active、AppID/商户、DIRECT模式、入口/VPC、受控数据库与支付配置、公钥标识和凭据存在性匹配；付款及退款执行仍关闭。未输出环境变量、密钥或原始云端响应。

证据：wechat-miniprogram/.artifacts/payment-closed-recheck-20261010.json，保留工具实际返回UTC时间。仅查询GetFunction，不调用建单、关单、退款、结算，不修改配置或权限、不上传。此结果不证明凭据被微信接受、签名通知成功、付款或退款到账。

方案未变：需求方付款/原路退款走微信；服务方提现沿用银行批量付款。用户最新问“现在不是用微信支付的方案吗”，已解释收款与出款的区别；这不是银行卡账户版本/核验/正式导出新增本地开发的批准，该范围保持待明确回复。

按现有 tax-and-payment-test-plan-2026-09-28.md，真实小额收退款验收不以税后钱包开发完成为前置；仍需不同真实参与者及完成确认的订单、具体金额费用与开关范围授权、退款审核身份/配置，以及通知和查单验收。第二账号暂缓的决定未被撤销。不得把银行模块待确认说成微信收退款技术上必须停工，也不得以自行给自己下单替代真实参与者。
