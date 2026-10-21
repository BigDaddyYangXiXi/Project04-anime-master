# 上线前置条件当前只读核对

2026-10-07本轮没有生产业务写入、清理调用、迁移、扩权或资金操作。不是完整验收。

## 当前资金与结构

公司库身份匹配。orders/payments/settlements均0；付款待人工检查、未完成恢复、未决预支付、已验收未准备结算等聚合项均0。这说明尚无真实资金全链证据，不能将零异常算成真实支付成功。存在1条已消费请求签名计数，不等于付款记录。

结构检查ok=false：66项字段要求与17项索引要求未满足，涉及bank_settlement_batches、bank_settlement_sources、withdrawal_requests、withdrawal_bank_payments、withdrawal_receipt_events、withdrawal_sources、finance_net_settlements，以及fund_journals/fund_postings枚举。与已有未迁移边界一致，不是线上已运行支付突然损坏。对应生产迁移/最小权限仍须完成实现与具体审批，未执行。

## 当前媒体

26条媒体、15条READY、4条DELETED；READY缺少有效审核PASS记录为0。待判定/已提交未送审/无trace等本次检查计数为0。未提交上传6条；等待存储清理1条，观察年龄1138120018毫秒，约13.17天。只读GetFunction确认media-pending-cleanup为Active、触发器0，符合既有受控清理设计。年龄不能作为删除授权；没有足够证据归因之前删除为何未完成，也未读取图片/真实身份/私人正文。

## 运行验收访问边界

0.9.11已上传，体验版最后核实0.9.9。上一轮computer-use可列出微信后台Chrome窗口，但读取状态时因无法可靠判定网址而被工具安全检查终止；没有继续输入或绕过。此前OpenCLI无连接。不能宣称后台体验版已更新，也不能再要求用户截图作为代码上传前置。

证据均在wechat-miniprogram/.artifacts：company-payment-health.json、payment-schema-current-20261007.json、company-media-health.json、media-cleanup-trigger-state-20261007.json。总目标仍包含真实交易/退款/20%平台费/服务方净额银行到账、隐私安全、双账号和平台发布；首开/定位与上述条件均不能由空库或本地测试替代。
