# 税务模块部署与最小权限审阅

## 当前证据

- 2026-09-27 生产只读information_schema查询确认：provider_tax_submissions、provider_tax_profile_versions、provider_tax_profile_reviews、tax_assessment_drafts四表数量为0，尚未迁移。
- payment-api全部212项单元测试通过；结果见wechat-miniprogram/.artifacts/tax-payment-regression-2026-09-27.txt。
- 待部署目录wechat-miniprogram/.artifacts/company-payment-functions/payment-api已同步60个源码/依赖清单文件，逐文件SHA256相同，本地模块引用检查无遗漏。现有package-lock一致，没有重新安装或升级依赖。
- 摘要清单：wechat-miniprogram/.artifacts/tax-payment-package-manifest-2026-09-27.json。未改私有部署配置、商户证书、资金开关或生产函数。

## 本次待批准权限范围

按0044、0045、0046、0047、0048顺序建立四张空税务表及提交关联约束。0048只修改本次新建身份表，不改订单、付款、退款和旧账本表。

支付运行账号am_payment新增权限只限：

| 表 | 权限 | 用途 |
|---|---|---|
| provider_tax_submissions | SELECT、INSERT、UPDATE(id) | 保存本人加密资料、查询状态，以及同键重试的id=id无实质覆盖 |
| provider_tax_profile_versions | SELECT | 查询本人审核状态 |

不授予DELETE、DDL、GRANT OPTION、审核状态更新、解密专用账号权限或另外两张税务表的写权限。UPDATE仅id列，不允许支付运行账号改资料密文、账号归属或审核结果；公开处理器不接受主键变更请求。

执行前需再次读取数据库账号的实际Host，绑定现有账号，不能新建通配Host账号或猜测身份。审核操作账号的生产最小权限单列，当前不创建/扩权。

## 部署边界

即使权限批准，税务提交保持未启用，不配置测试密钥或测试告知。仅在正式告知、独立密钥管理、页面、实名审核和生产配置核实后开启真实资料采集。此批准不授权申报税、真实扣款、退款、银行付款或新增商业规则。

生产迁移与授权后，需以真实am_payment连接验证只读和必要写入范围（如需写入验证，使用显式合成测试记录并说明清理方式），再部署已核对的包并核验线上关闭态。关闭态证据不能代替正式支付和结算验收。

## 已批准并执行的生产迁移与部署

> 2026-09-27 用户明确批准清单后生产落地：migrate-tax-approved.js先复核公司库/root管理上下文、现有am_payment网段Host和四表不存在，再执行0044至0048。四张税务表及提交关联已创建；回读确认am_payment对submissions只有Select/Insert及id列Update，对profile_versions仅Select，另两表无新增权限；四表云端规则均ADMINONLY。payment-api已使用既有商户配置单函数部署成功，部署后Active/Nodejs20.19，环境配置逐项相同，支付退款结算及真实税务资料采集保持关闭、无税务生产密钥。getTaxProfileStatus/submitTaxProfile真实匿名调用均AUTH_CONTEXT_MISSING。证据.artifacts/tax-approved-migration-2026-09-27.json与tax-live-deployment-audit-2026-09-27.json。未做真实资料/税务申报/资金动作；真实am_payment正向业务读写、登录微信正向、填写UI、实名/统一纳税人归并、年度累计/净额到账及真机双账号仍待，不以关闭态与匿名拒绝视为上线完成。

本节覆盖前文待授权、未迁移及未部署的历史状态。用户答复为允许按清单迁移并授权；未扩大至审核写权限、真实资料采集、报税或资金操作。迁移命令不自动重跑已存在表，避免失败后覆盖或重建。


> 2026-09-27 生产运行账号权限实测通过：临时 VPC 函数以 am_payment 执行合成事务，新增及同 ID 重试成功、身份版本读取成功；修改资料密文、删除资料、修改审核结果和读取另两张税务表均被 MySQL 权限拒绝。事务全部回滚，测试记录残留 0；临时 tax-permission-probe 已删除且 ListFunctions 返回 0。证据 wechat-miniprogram/.artifacts/tax-live-permission-probe-2026-09-27.json。仅验证数据库权限，不代表真实微信提交、实名核验、税务申报或资金闭环完成；真实采集及资金开关保持关闭。
