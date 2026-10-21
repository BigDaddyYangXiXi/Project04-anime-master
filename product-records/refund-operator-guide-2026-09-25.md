> 2026-09-26 更新：fundAudit已获查询权限并完成部署，覆盖下文历史待授权/待部署说明。云端鉴权及只读空列表检查通过，尚无真实付款的完整对账结果。审核和退款开关保持关闭。

# 退款管理操作指南

当前状态：独立云函数已按只读配置部署，本机工具真实查询通过；审核和退款执行保持关闭，不含支付私钥。目前技术查询标识为 `refund_query_service`，不代表实际审核人；开放审核前必须落实审核人并更换此标识。本指南不是已可操作生产退款的声明。

## 配置边界

独立函数名称为 `payment-refund-operator`，入口 `index.refundOperator`，公司环境固定为 `cloudbase-d2g65rqbvee0bd978`。不挂公网路由，不向小程序提供管理动作。专用操作凭据与固定审核员标识分别由服务端 `PAYMENT_REFUND_OPERATOR_TOKEN`、`PAYMENT_REFUND_REVIEWER_ID` 提供，不能由请求指定审核员。

- `refundOperatorEnabled`：管理入口总开关。
- `refundReviewEnabled`：审核开关；审核通过不自动退款。
- `refundEnabled`：原退款执行开关；渠道转发和防重服务还须具备对应配置。

初次部署只验证查询能力，审核和资金执行保持关闭。不得复用自动补查凭据作为管理员凭据。实际审核人、凭据保管和启用权限须在开放前落实。

## 本机只读查询

工具：`wechat-miniprogram/scripts/refund-operator-console.js`。在 `wechat-miniprogram` 目录运行：

```powershell
node scripts/refund-operator-console.js --query .artifacts/refund-query.json
```

查询文件不得放入凭据。待审核列表内容示例：

```json
{"action":"list","status":"REQUESTED"}
```

每页最多20条；下一页将返回的 `nextCursor` 原样放入查询文件的 `cursor` 字段。切换状态时删除旧游标。列表是当前状态查询，不是冻结的批次快照；处理期间有申请状态变化时，应从首页重新检查待办。

详情查询示例（将编号替换为列表中的真实编号）：

```json
{"action":"read","refundId":"填写32位退款编号"}
```

异常收款查询文件使用 `{"action":"paymentReviews"}`，下一页同样附返回的cursor。列表区分原订单金额/币种与渠道确认金额/币种，并显示待核对原因；不能把这些款项作为服务方收入。查询不会解除异常或自动退款。

公开查询命令只接收list/read/paymentReviews，不能审核或提交退款。配置从受忽略的 `.cloudbase-cli-config/merchant-configured-closed/payment-refund-operator.json` 读取；不要把该文件加入版本控制、发送聊天或复制到前端。输出可能包含申请原因和审核证据，仅用于授权管理。

## 审核与执行流程

本地审核工具为 `wechat-miniprogram/scripts/refund-review-console.js`。尚未开放云端审核，当前 `refund_query_service` 身份会被该工具拒绝；落实实际审核身份、启用审核并获得具体单据授权后才可使用。

- `--prepare <decision.json>`：仅查询，输出审核计划，包含退款编号、原付款/订单、申请金额、原因及固定审核员。决定文件字段为action=review、refundId、decision=APPROVE或REJECT、evidenceReference。
- `--apply <plan.json>`：重新核对原单及审核员，只提交一次审核，然后读取原记录确认。响应丢失不自动重发；已有相同决定直接确认，冲突或无法核对时报未确认。
- 审核计划需人工核对后保存为独立文件，不得把prepare和apply自动串起来。计划可能含退款原因，应存于受忽略的本地目录。
- 该工具不支持退款执行；审核成功不能代表资金已退回。

1. 查待审核列表和详情，核对原付款、退款金额、申请原因、冻结原因及已有审核记录。
2. 保留审核依据。争议冻结、已进入结算或金额不符时按既有业务规则处置，不绕过后端阻止条件。
3. 后续受控管理工具提交审核决定，审核员由服务端固定。审核响应不明时先查询原记录；同一决定和依据可核对，冲突不能覆盖。
4. 批准后单独执行原退款编号；执行不是审核的隐式副作用。真实退款须在具体单据、金额及授权确认后操作。
5. BUSY表示已有执行处理中；QUERY_REQUIRED或执行异常表示结果需核对。保持原退款编号，不能创建新单或直接重复渠道提交。
6. 查询/验签通知确认退款终态后核对累计退款、20%/80%冲正和渠道记录。只有实际到账证据可证明用户收到退款。

### 退款执行工具

`wechat-miniprogram/scripts/refund-execution-console.js` 提供 `--prepare <request.json>` 与 `--apply <plan.json>`，请求格式为 `{"action":"execute","refundId":"原退款编号"}`。

prepare仅查询，要求原单已批准、原付款状态正常、无争议或结算占用、尚未提交，输出原金额与审核依据供核对。计划必须单独经授权确认，不能自动串接apply。当前云端退款开关关闭且没有支付密钥，不能进行真实退款。

apply重新核对金额和审批快照。若已有持久化提交时间，则只返回原单状态；否则最多调用一次执行入口，再读取原单。响应丢失不重发，未找到提交记录或读取失败均报告未确认，应继续查询原编号。返回的channelSuccess仅指系统记录的渠道成功，不替代用户实际到账验收；PROCESSING/ABNORMAL等仍需查询和处置。

已验证：云端配置精确匹配、无凭据拒绝、本机工具查询真实待审核队列成功（2026-09-25，0条）。证据见 `wechat-miniprogram/.artifacts/company-refund-operator-audit.json`。

尚待：实际审核身份与授权配置、管理员使用体验、真实审核/单据及到账验收。审核和执行工具已本地测试，未作真实审核或退款。双账号测试按用户决定暂缓，仍保留为正式上线待办。

## 公司资金账本只读检查（2026-09-25，本地完成，待权限与部署）

查询文件内容：`{"action":"fundAudit","paymentId":"真实32位付款单号"}`。
使用现有 `refund-operator-console.js --query 查询文件路径`。凭据仍经标准输入传递，查询文件不含密钥。

服务端限定当前配置的公司商户、AppID和DIRECT模式，使用同一只读事务快照检查付款、退款、冲正和分录。返回中的外层成功仅表示查询成功；内层 `ok:false` 表示发现对账差异。出现差异须保留原记录并人工核查，不自动修账。即使内层 `ok:true` 也仅表示本地业务账一致，不证明微信账单或银行到账一致。

部署前置：am_payment 对 fund_postings 仅有 INSERT，新增 SELECT 必须另获用户授权。准备包已有此入口，但尚未部署，也未扩权。16项入口/工具与146项MySQL测试通过。
