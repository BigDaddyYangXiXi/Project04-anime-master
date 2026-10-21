# 提现预留账号权限草案与本机实证

范围：公司AppID wxc94e1c1b38944511，目标库cloudbase-d2g65rqbvee0bd978。仅为后续部署准备；未创建生产账号、授权、迁移、部署或操作真实资金。

## 验证结论

在完整迁移的本机MySQL隔离库，新建随机临时账号，先只授予下述SELECT及INSERT。实际reserveWithdrawalSources被拒绝，错误为SELECT with locking clause权限不足；失败事务没有创建来源。随后增加指定标识列UPDATE，来源追加、原来源幂等重试和10并发相同付款预留均成功，实际付款条目仅1条，payable=false。

同时实测拒绝：修改提现批准金额、净额金额、财务批准指纹、账本分录、银行付款状态，删除来源/付款条目，以及读取accounts。临时账号及随机测试库由测试finally/after清理。证据wechat-miniprogram/.artifacts/withdrawal-permissions-20260930.txt；先前仅SELECT/INSERT失败证据withdrawal-permissions-before-20260930.txt。

这只验证预留模块所需的权限边界，不涵盖账户本人核验、申请/财务批准、银行导出、回单核销或出款账本权限；不得以此把预留账号升级为通用财务账号。

## 权限矩阵

拟设独立内部预留身份，不复用客户端或财务导入账号。最终生产账号名称、网络来源与TLS设置需部署时明确核对和授权。

| 表 | SELECT | INSERT | 额外列权限 |
| --- | --- | --- | --- |
| withdrawal_requests | 是 | 否 | UPDATE(id)，行锁用途 |
| withdrawal_bank_payments | 是 | 是 | UPDATE(id)，行锁用途 |
| withdrawal_receipt_events | 是 | 否 | 无；2026-10-03新增终态证据读取，生产授权待审查 |
| withdrawal_sources | 是 | 是 | UPDATE(payment_id)，行锁用途 |
| finance_net_settlements | 是 | 否 | UPDATE(payment_id)，行锁用途 |
| order_payments | 是 | 否 | UPDATE(id)，行锁用途 |
| order_aggregates | 是 | 否 | UPDATE(id)，行锁用途 |
| order_refunds | 是 | 否 | 无 |
| order_funds_interlocks | 是 | 否 | 无 |
| order_refund_reversals | 是 | 否 | 无 |
| fund_journals | 是 | 否 | 无 |
| fund_postings | 是 | 否 | 无 |
| finance_result_imports | 是 | 否 | 无 |

不授予DELETE、DDL、GRANT OPTION、整表UPDATE或全库通配读写，不读取accounts、税务密文或银行卡明文。将来银行卡版本核验接入后，新增必要读取/行锁权限需另行合并审查和验证。

列权限本身允许改变该标识列，并非数据库强制“只能id=id”。此方案依赖受信服务端代码、禁止客户端提交SQL、凭据私有保存及完整财务证据校验；不可将其描述为数据库完全不可变。若目标环境采用不同MySQL权限语义，需先在等效隔离环境验证，不因为报锁权限错误就补整表UPDATE或DELETE。

## 生产执行前顺序

1. 完成账户核验、导出时实时检查和特殊退款/税款更正相关实现，确定最终真实入口及操作员授权；当前无开放预留API。
2. 将0042/0043/0050/0052/0053/0054迁移、备份/失败恢复步骤、上述权限及部署文件哈希形成同一份可审查变更包。银行卡新增结构尚未确定，不能提前宣称清单完整。
3. 核对公司数据库与当前私网来源限制，强制TLS；凭据不进入前端、Git或聊天。取得具体变更授权后才执行。
4. 部署后检查SHOW GRANTS、禁止操作负例与受控业务正例；真实资金仍按单独批准的验收步骤执行。

本轮只添加本机权限集成用例和本方案，没有修改预留业务实现。
