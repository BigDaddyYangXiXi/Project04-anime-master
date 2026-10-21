# 公司支付结构迁移 0023—0027

目标环境：cloudbase-d2g65rqbvee0bd978，同名MySQL数据库。迁移前实时只读核查：order_aggregates=0行、order_payments=0行；order_settlement_tasks不存在；付款表无prepay字段、恢复标记或核对索引。不能将这次空表证据用于未来迁移。

顺序：0023新增分账任务表及外键/唯一约束；0024扩展任务回执及终态约束；0025新增预支付字段；0026新增恢复标记；0027新增后台核对索引。SQL已经过隔离本地MySQL集成执行，本次仍需公司MySQL8.0.30实测。

执行前保存两张既有表SHOW CREATE TABLE结果与行数，路径为受忽略`.artifacts/payment-schema-before-20260924.json`。这只是结构快照，不是完整数据库备份。已有自动备份由平台管理，不对整库执行恢复。

逐个执行，遇错停止并查information_schema定位实际成功边界，不盲重跑非幂等ALTER。不更新/删除业务行，不删除旧列，不启用付款入口。回退应用代码时保留新增兼容结构；若需撤销DDL须另行确认新表无数据、依赖和写入已停止，不能自动DROP或恢复整库覆盖用户数据。

后验：检查列类型、索引列顺序/唯一性、InnoDB、CHECK/外键定义、新旧表计数，并补授am_payment对order_settlement_tasks的SELECT/INSERT/UPDATE（指定私网子网来源）。不能授全库权限或授权转授。此迁移不等于支付业务部署、商户产品资格或真实资金验收。

### 2026-09-24 公司库支付迁移0023—0027已执行与核验
迁移前实时只读确认order_aggregates/order_payments均0行，分账表不存在，付款表27列且无预支付/恢复标记/核对索引。保存两旧表SHOW CREATE TABLE及计数至受忽略wechat-miniprogram/.artifacts/payment-schema-before-20260924.json；该文件是结构快照，不是全库备份。具体范围与回退约束见payment-schema-rollout-2026-09-24.md。
通过现有公司管理SQL通道顺序应用0023、0024、0025、0026、0027，5条语句均成功，未重跑、未更新删除业务行。SHOW CREATE TABLE分账表确认InnoDB、订单/付款外键ON DELETE RESTRICT、订单/付款/通道单唯一约束、四种状态及时间CHECK。新增只读scripts/audit-company-payment-schema.js复用inspectPaymentSchema，实际执行ok=true，columnIssues/indexIssues均空，订单/付款/分账计数仍全部0。该证据不等于真实业务行为验收。
am_payment已补授指定私网来源对order_settlement_tasks的SELECT/INSERT/UPDATE；没有DELETE/DDL/全库授权。后续信息架构TABLE_PRIVILEGES回查授权范围。占档账号不增加权限。主客户端enabled=false和真实付款入口未改，业务order-api/payment-api/查询relay尚未部署。下一步完成资金写操作通道、业务云端部署及带数据事务验收；真实商户产品资格/个人进件和退款对账仍待。
