# 公司云部署清单（2026-09-25）

实际查询时间：2026-09-25T04:36:44.861Z。环境：cloudbase-d2g65rqbvee0bd978。

来源：官方公司CLI完整函数分页及HTTP服务列表。清单只证明资源存在和部署状态，未比较云端代码哈希，也不证明真实账号、资金或发布验收。

## 当前函数

| 函数 | 运行时 | 云端修改时间 | 状态 |
|---|---|---|---|
| account-api | Nodejs20.19 | 2026-09-24 17:47:07 | 部署完成 |
| account-bootstrap | Nodejs20.19 | 2026-09-24 18:10:27 | 部署完成 |
| auth-probe | Nodejs16.13 | 2026-09-25 05:52:24 | 部署完成 |
| availability-api | Nodejs20.19 | 2026-09-24 13:32:29 | 部署完成 |
| catalog-read | Nodejs20.19 | 2026-09-24 16:35:35 | 部署完成 |
| media-pending-cleanup | Nodejs20.19 | 2026-09-24 19:19:08 | 部署完成 |
| media-security-submit | Nodejs20.19 | 2026-09-24 13:41:17 | 部署完成 |
| media-upload | Nodejs20.19 | 2026-09-24 13:40:06 | 部署完成 |
| network-probe | Nodejs20.19 | 2026-09-24 04:12:15 | 部署完成 |
| network-probe-public | Nodejs20.19 | 2026-09-24 04:11:22 | 部署完成 |
| order-api | Nodejs20.19 | 2026-09-25 03:43:45 | 部署完成 |
| order-notification-private | Nodejs20.19 | 2026-09-24 12:27:58 | 部署完成 |
| order-notification-public | Nodejs20.19 | 2026-09-24 12:37:31 | 部署完成 |
| order-slot-confirm | Nodejs20.19 | 2026-09-25 06:12:26 | 部署完成 |
| payment-api | Nodejs20.19 | 2026-09-25 05:35:25 | 部署完成 |
| payment-mutation-guard | Nodejs20.19 | 2026-09-25 04:08:50 | 部署完成 |
| payment-mutation-relay | Nodejs20.19 | 2026-09-25 04:08:01 | 部署完成 |
| payment-notify | Nodejs20.19 | 2026-09-25 05:09:18 | 部署完成 |
| payment-query-relay | Nodejs20.19 | 2026-09-25 02:33:22 | 部署完成 |
| payment-refund-notify | Nodejs20.19 | 2026-09-25 04:00:31 | 部署完成 |
| payment-refund-operator | Nodejs20.19 | 2026-09-25 05:23:14 | 部署完成 |
| payment-refund-worker | Nodejs20.19 | 2026-09-25 04:29:33 | 部署完成 |
| project-api | Nodejs20.19 | 2026-09-24 13:33:38 | 部署完成 |
| provider-catalog-draft | Nodejs20.19 | 2026-09-24 13:35:56 | 部署完成 |
| saved-items-api | Nodejs20.19 | 2026-09-24 16:37:22 | 部署完成 |
| wechat-message-callback | Nodejs20.19 | 2026-09-24 11:22:56 | 部署完成 |

## 公网回调

| 路径 | 目标函数 |
|---|---|
| /wechat-message-callback | wechat-message-callback |
| /wechat-payment-notify | payment-notify |
| /wechat-refund-notify | payment-refund-notify |

## 发布前未完成项

- auth-probe代码已更新，但实际运行时仍为Nodejs16.13；不能用本地配置中的Node20当成已升级证据。
- network-probe和network-probe-public仍存在，发布前核对其调用方、诊断用途和凭据后决定保留或清理，不能直接删除。
- 本轮临时company-sdk4-readonly-probe不在清单，此前删除回查已确认。
- payment-refund-operator现在线上只读退款/异常收款版本；fundAudit仍为本地待部署，待fund_postings查询授权。
- payment-api供需退款查询已部署；最新退款前端已上传开发预览，尚无正式发布及完整实屏验收。
- 已有配置核验显示付款/退款执行关闭；本次资源列表不重新证明开关状态，开启前必须重新核验。
- 真实支付/退款/80%到账、双账号验收、备案类目与审核材料、全服务代码版本对照和监控仍待完成。

## 后续更新

运行`node wechat-miniprogram/scripts/audit-company-deployment-inventory.js`刷新脱敏JSON清单；更新本文时保留代码/配置/业务验收的区别。

## 网络诊断函数复核（2026-09-25T04:44:47Z）

两个诊断函数均无HTTP路由、无定时触发器，只配置诊断令牌/模式；真实无令牌调用均拒绝。项目源码搜索仅找到诊断函数自身互调，未发现业务消费者，但不代表外部管理调用不存在。未删除函数。证据：wechat-miniprogram/.artifacts/company-network-probe-audit.json；复查工具：scripts/audit-company-network-probes.js。


## 付款补查部署增量（2026-09-25T04:53:12Z）

payment-query-worker已新增部署，index.paymentReconcile/Node20.19/60秒，无公网路由及定时触发器。部署前完整查询26个且同名不存在，故当前新增为27个；上方表格仍为04:36历史快照。配置匹配、鉴权拒绝及Timer格式手动空队列扫描通过，不是自动调度或真实付款恢复验收。后续继续创建定时器并取得自动执行证据。


## 付款自动补查配置增量（2026-09-25T04:56Z）

付款补查每5分钟定时器已启用，周期及独立凭据回查匹配；人工Timer格式空队列扫描成功。首次待核自动时点05:00Z。使用scripts/audit-payment-worker-schedule.js只读查询监控，不能以人工调用替代自动证据。后续代码更新使用fn code update，避免无触发器的初始部署配置覆盖已启用定时器。

接口参数核对：[腾讯云CreateTrigger官方说明](https://cloud.tencent.com.cn/document/api/583/18589)。


## 自动运行证据（2026-09-25）

北京时间13:00至13:50共11个5分钟时点，Invocation各为1、Error各为0，Duration为5—750ms。05:53:26Z查询取得，证据wechat-miniprogram/.artifacts/payment-worker-scheduled-metrics.json。最近记录人工调用12:56:08，观察窗口本线程未手动调用。此证据关闭自动调度是否实际运行的疑问，不关闭真实付款通知丢失恢复及到账验收。

