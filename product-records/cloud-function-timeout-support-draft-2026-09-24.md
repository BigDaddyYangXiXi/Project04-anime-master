# 腾讯云工单202609238321补充内容（待批准，尚未发送）

请协助排查公司CloudBase环境 `cloudbase-d2g65rqbvee0bd978` 的部分云函数调用超时。当前无法从管理接口配置状态解释故障，也没有可查询的CLS主题。

## 故障和对照

- `payment-query-relay`：2026-09-24北京时间19:08—19:14间，SCF Invoke及小程序 `wx.cloud.callFunction` 多次失败。小程序错误为 `-501002 resource server timeout / ESOCKETTIMEDOUT`，最新调用ID `1790248379043-0.6610133639102032`，19:12:59发起、19:14:06系统错误。参数为空对象，函数配置关闭，按代码应立即返回拒绝，不请求数据库或微信支付。
- 同环境的 `payment-mutation-guard`、`payment-mutation-relay` 均能通过原生SCF和小程序返回预期拒绝。正常请求ID：`63603850-3118-4949-84e1-fe225e669fbe`、`f286e7ae-4497-4b65-b2b9-8f23fa81184e`。
- `media-pending-cleanup` 更新后，无有效令牌的SCF调用也未取得结果；管理审计等待60秒结束。该项暂未取得明确的云端错误码，不与查询服务的资源超时作同一根因断言。请求不含有效清理令牌，不应访问数据库或删除文件。

## 已排查内容

1. 三个对照服务均为Active、Available、CodeResult=success、ErrNo=0，StatusReasons为空；Nodejs20.19、Event类型、256MB/0.2CPU、InitTimeout65秒、TCB_QcsRole，集群 `ap-shanghai-tcb-cube-1`。
2. 查询和交易转发均timeout20秒、无VPC、公网ENABLE、EIP关闭、无Layers、无触发器、InstallDependency=FALSE。清理服务timeout60秒，其余上述条件一致。
3. 查询服务云端代码包已下载并校验平台摘要，10个文件逐字节与本地已测试包一致。相同代码、相同关闭配置重新部署成功后仍复现。未通过增大超时、扩大权限或关闭鉴权处理。
4. CLI日志查询返回 `ResourceNotFound.TopicNotExist`；GetFunction中ClsTopicId为空。未擅自创建付费日志资源。
5. 付款和结算开关始终关闭，未提交真实支付请求，未清理现有媒体。
6. 之后创建同代码、同关闭配置的临时函数payment-query-diagnostic，19:32:37调用也明确网络超时；原函数单一资源异常不足以解释现象。临时函数测试后已删除并核实不存在，未遗留资源。

请确认上述失败调用是否到达函数实例、是否有初始化/调度/路由故障，并提供该调用的后台诊断结果。若必须先接入CLS，请说明现有套餐可用的日志方式、具体配置和额外费用，勿直接调整套餐、网络、权限或启用资金操作。

本文不包含数据库密码、清理令牌、商户私钥、API密钥、手机号或业务订单资料。发送前需确认工单当前状态并追加已有工单，不重复创建同类工单。
