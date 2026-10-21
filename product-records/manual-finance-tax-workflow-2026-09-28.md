# 财务人工核算与结果回录

用户最新决定取代自动累计计税/自动申报的产品开发目标。服务方只需必要身份/收款资料、授权及结算结果，财务在平台外完成计算和申报。

## 当前可执行的本地步骤

1. 沿用bank-finance-export将后台review快照导为CSV，金额未知不得填0。现有导出仍缺真实身份关联、收款账户和历史税务全量明细，不能声称已提供财务所需全部资料。
2. 后台使用finance-tax-result-review.snapshotHash(review)生成来源指纹。财务结果包含batchId、sourceSha256、resultId、evidenceReference及records；每条含orderId/paymentId/providerId、taxPeriod、providerPretaxFen、incomeTaxFen、vatFen、surchargeFen、providerNetFen、basisReference。所有金额为整数分字符串，零税必须明确填写并有依据。
3. 运行：node scripts/finance-tax-result-cli.js --review 来源快照.json 财务结果.json 核验结果.json finance_owner。技术操作员录入结构化结果；不要求财务老师自行编辑JSON。CSV表格转入已完成（见下方），正式后台和数据库回录仍待接通。
4. 输出是VALIDATED_DRAFT，不写数据库、不表示审批、已扣缴或可付款。结果文件不覆盖；失败只返回脱敏错误。

## 接通正式结算时

授权财务审核后，事务内重查真实付款/退款/冻结与来源指纹；同结果幂等、变参拒绝；原子保存人工核算凭据、扣留税款和服务方净额。文件hash只用于核对来源版本，不是签名或财务身份凭证。

累计报税由财务处理。系统需导出相应历史收入/退款/已扣缴/已申报记录，保存人工更正而不覆盖历史。已计算、已扣留、已申报、已缴税分开，申报凭证不能由试算自动生成。

没有真实身份和净额来源不得付款；新增生产表权限仍按清单申请，既有批准不自动扩展。

## 财务CSV往返入口（2026-09-28已实现）

后台操作员运行 `node scripts/finance-tax-result-cli.js --template 来源快照.json 财务回填.csv`。财务只填写税款所属月、个人所得税、增值税、附加税费、税后净额、核算依据编号六列；前六列不得修改。金额单位元，最多两位小数，零税明确填0，禁止空白代替0；编号与月份按文本保留。保存为UTF-8逗号CSV。

回收后运行 `node scripts/finance-tax-result-cli.js --review-csv 来源快照.json 财务回填.csv 元数据.json 核验结果.json finance_owner`。元数据仅含resultId、evidenceReference，由后台操作员提供，财务无需编辑JSON。沿用整批完整性核对；漏行/重复/来源变化/公式金额/多余扣款拒绝，不创建结果文件，已有文件不覆盖。

16项导表、人工结果和CSV/CLI测试通过；并未实际使用Excel/WPS人工保存验收。该工具仍是受控本机入口，结果是核验草稿；不是生产授权审批、实际扣缴或钱包入账。原始财务核算凭证由受限后台保管，依据编号不能代替其真实性核验。

## 财务结果导入入口（2026-09-28，本地实现）

在 wechat-miniprogram 目录使用：

```text
node scripts/finance-result-import-cli.js --import <原导出快照.json> <已校验财务结果.json>
```

第二个文件可使用 finance-tax-result-cli --review-csv 生成的结果文件。入口重新校验来源指纹、订单与服务方、税额及净额，并限定公司 AppID/商户号。操作人从受控 BANK_BATCH_OPERATOR_ID 配置读取，文件内 operatorId 不作为授权来源。

数据库配置使用 ORDER_MYSQL_CONFIG，必须由运维注入，不填入命令行或聊天；强制校验证书和主机名的 TLS，仅接受公司库 cloudbase-d2g65rqbvee0bd978 与专用账号 am_finance_import，拒绝空密码；不得使用付款、管理员或其他账号。0051 财务结果表已于2026-09-29获用户授权后在生产创建，核验为空表；财务专用账号最小权限尚未申请/执行，当前仍不能直接在生产运行导入。所需权限是该表 SELECT、INSERT、仅 id 列 UPDATE（用于原编号幂等写入），不需要删除权限。

成功仅返回 IMPORTED_PENDING_REVIEW、payable=false。重复相同结果幂等；同编号不同结果或操作人拒绝覆盖。该状态不代表财务已批准，更不代表钱包已入账；批准前必须核对当前退款、争议冻结、来源变化并原子登记净额账本。未实现部分不得以此导入入口替代。

本轮入口/CSV/结果校验共11项测试通过；本轮未连接生产财务库或写入真实资料。此前本地保存模块的真实数据库测试不等于本入口的生产验收。
## 2026-09-29 事务边界补验

新增finance-tax-result-store.test.js四项连接替身测试，覆盖重复结果、变参冲突、提交响应丢失、回滚失败销毁连接及金额校验先于连接。与入口和结果校验共11项通过；未发现需改保存逻辑的问题，不能替代真实数据库事务测试。0051仅建空表的授权已单独请求、尚待回复；未申请或执行账号扩权、真实资料导入与付款。

## 2026-09-29 生产空表已建立

用户明确批准仅建finance_result_imports及索引。公司环境迁移执行成功，回读DDL并确认0行；证据wechat-miniprogram/.artifacts/finance-result-schema-20260929.json。没有创建账号或增加权限，没有真实资料导入、钱包入账或付款。上文“0051授权待回复”是历史记录，已由本次批准与执行取代；后续权限和批准结算功能仍待。

2026-09-29：连接目标约束反例先失败后修复，16项导入/CSV/核算/事务测试通过。生产专用账号授权仍待，不因本地代码支持而代表真实导入可用。

## 当前来源复核模块（本地）

finance-result-live-review.js复用既有批次只读事务，检查批次状态、来源、冻结、账本及公司范围，再按原指纹和金额核验人工结果。7项相关测试通过，包含退款、费用变化、冻结、取消和读取失败。尚未接入正式后台或生产调用；输出仅LIVE_RECHECKED_DRAFT/payable=false，不代表批准。独立只读事务结束后仍可能发生变化，批准净额入账必须在资金写事务中再次加锁核验，当前模块不解决该并发边界。

## 当前来源复核操作入口

在wechat-miniprogram目录执行：

```text
node scripts/finance-result-live-cli.js --review <已校验财务结果.json> <当前来源复核结果.json>
```

入口沿用受控payment-refund-operator的bankReview只读查询，操作人读取私有部署配置BANK_BATCH_OPERATOR_ID；不接受输入文件指定操作者。通道令牌由已有实现通过子进程标准输入传递，不进入系统命令行。结果以独占方式保存且不覆盖已有文件。12项相关测试通过，尚无真实财务结果生产运行证据。

该入口不需要新财务导入账号权限，但依赖既有后台只读通道正常可用。结果仍为LIVE_RECHECKED_DRAFT/payable=false，不批准、不入账、不付款；最终批准必须在同一写事务再次重查来源和冻结。
