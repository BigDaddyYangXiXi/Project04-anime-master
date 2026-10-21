# 订单通知只读排障

在项目 `wechat-miniprogram` 目录运行 `node scripts/audit-company-notification-health.js`。工具先核对公司数据库名，再查询汇总数量与时间，结果保存到 `.artifacts/company-notification-health.json`；不返回账号、openid、订单编号、消息正文或密钥。失败以非零退出，不把读取失败当成零条。

| 指标 | 含义及处理边界 |
|---|---|
| started | 已领取发送执行权，但还没有确定结果。可能正在执行，也可能进程中断；结合开始时间、函数日志和已有结果排查，不直接再次发送。 |
| unknown | 渠道响应或内部调用结果无法确认。保留收据，不删除防重记录来重试；取得可信的原次调用结果后再走既有结果记录流程。 |
| acknowledged | 微信渠道已明确受理。不能声称用户收到、阅读或仍有订阅额度。 |
| rejected | 本次流程被明确拒绝；可能在发送前复核时拒绝，也可能为微信渠道拒绝。不能全部解释为用户关闭了通知。 |
| oldestUnresolvedStartedAt | STARTED/UNKNOWN 中最早开始时间，单位为 Unix 毫秒；没有记录时为 null。它是排障线索，不是自动重发或超时改状态的依据。 |
| acceptEvents / rejectEvents / changeEvents | 验签后保存的历史微信观察事件数，changeEvents 与 rejectEvents 重叠。不是当前同意人数、送达数或剩余发送额度；不能相加得出用户数量。 |

查询不是同一事务快照；并发更新时各次结果可能变化。首次空表检查只能确认查询可执行。定时告警、负责人、处理频率和记录保留规则尚未确定，当前工具不承担这些功能。

排查顺序：先看 `audit-company-notification.js` 的配置、签名及只读路径结果；再用 `audit-company-notification-code.ps1` 核对实际部署代码；最后结合本工具和可信日志检查未决调用。恢复扫描只选没有任何收据的当前事件，不能用它补发 UNKNOWN/STARTED。

真实验收仍需要：双账号真实订单、用户主动订阅、微信验签回调落库、确定的发送结果与收据持久化、真机收信及按身份返回正确订单页。空查询、代码一致或本地模拟均不能替代。
