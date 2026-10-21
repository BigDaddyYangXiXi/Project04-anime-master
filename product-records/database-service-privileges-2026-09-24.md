# 公司库专用账号权限（已创建；具体云端验收范围见最新记录）

目标：为现有公司环境的付款事务和服务方确认占档提供分离账号；不使用root运行业务。凭据只通过控制台安全配置注入，不提交到仓库或聊天。

## 执行前核实

- 当前控制台连接串已核实数据库名为`cloudbase-d2g65rqbvee0bd978`，替代此前错误预设`tcb`；实际登录后再用DATABASE()核验，重新检查公网关闭和函数VPC配置。代码白名单不是网络隔离的替代品。
- 获取实际MySQL补丁版本；较早版本的锁定读取可能要求额外权限，不能为让测试通过直接扩大授权。
- 在控制台创建新的`am_payment`和`am_order`账号，使用生成的独立强密码。限制允许来源为实际VPC子网或平台支持的等价约束，不用公网`%`来源作为默认方案。
- 以下为授权矩阵，账号host部分必须以实际创建项为准，不提供会误执行的通配来源SQL。不修改root或旧业务账号。

## 源码已核对的权限

| 账号 | 表 | 权限 |
| --- | --- | --- |
| am_payment | accounts、wechat_identities、account_roles、provider_payment_merchants | SELECT |
| am_payment | order_aggregates | SELECT、UPDATE |
| am_payment | order_payments、order_settlement_tasks | SELECT、INSERT、UPDATE |
| am_order | accounts、provider_qualifications | SELECT |
| am_order | order_aggregates | SELECT、UPDATE |
| am_order | provider_slot_locks | SELECT、INSERT、UPDATE（2026-09-24用户明确批准） |

依据：payment-api的付款预留、查询恢复、收款落库、分账任务准备/查询；order-api/slot-store的服务方行锁、资格锁、订单冲突检查和确认写入。后续新增退款表或服务间持久鉴权表须重新审查本矩阵；禁止预先授予全库权限。

不给DELETE、CREATE、ALTER、DROP、GRANT OPTION或账号管理权限。数据库迁移由独立管理流程执行，不通过业务连接池运行。

## 云端验收与切换

1. 先只读检查CURRENT_USER、目标库、版本、SHOW GRANTS和必需表结构，脱敏保留结果。不得把现有严格TLS预检结果直接套用到私网非TLS模式。
2. 在授权的隔离测试数据范围验证实际账号能够执行事务、SELECT FOR UPDATE、条件更新和回滚；本地以root运行的测试不证明这些账号权限够用。
3. 核查无全库写权限、无DDL/授权能力；不在业务表执行破坏性操作测试权限。
4. 付款和占档部署前确认与CloudBase默认rdb指向同一业务库。留存旧配置回退，继续保持真实付款入口关闭，直到商户资格及支付全链路验收。

2026-09-24执行更新：已创建am_payment及am_order，账号Host均为172.17.0.0/255.255.240.0。SHOW GRANTS回查与上述已存在表权限匹配，无GRANT OPTION/DDL/DELETE；USAGE ON *.*不赋予业务表全局读写权限。order_settlement_tasks尚不存在，故该表授权未执行，需迁移后补齐。密码保存在受Git忽略的.cloudbase-cli-config/company-database-accounts.json，未输出；未注入业务函数，未完成专用账号云端连接/事务验收。

管理通道只读核实：DATABASE()为cloudbase-d2g65rqbvee0bd978，VERSION()为8.0.30-cynos-3.1.19.002，CURRENT_USER()为root@%。仅通过现有管理SQL通道建专用账号，没有获取、重置或修改root密码。执行脚本scripts/prepare-company-database-accounts.js默认仅展示计划，--apply执行；生成配置已存在时拒绝重复执行，不能删配置盲目重跑。

### 2026-09-24 专用数据库账号云端连接验收通过
新增临时database-probe，仅指定公司环境/地址/库名及am_payment、am_order两个账号，随机令牌认证；固定空SELECT、CURRENT_USER/DATABASE/VERSION检查、WHERE 1=0 FOR UPDATE空事务ROLLBACK，以及mysql.user LIMIT0越权读取必须失败。未查询业务内容、未写业务行、未运行支付。3项本地安全测试通过。
首次部署因平台将JSON环境变量推断为对象被CreateFunction拒绝（3e278f5c-e6ff-4323-bbb5-97c54dc62e2d）；改为base64字符串传递并在函数内解码后部署成功。base64仅为编码不是加密，凭据仍按受限云配置处理，不得输出/提交。配置和事件文件均在受Git忽略目录。
真实云调用0bc6a16e-1aea-40f9-a1a7-0ee6e1bc5378：两个账号databaseMatched/identityMatched=true，所有已授权表空读成功，emptyLockTransactionRolledBack=true，systemTableDenied=true；实际版本8.0.30-cynos-3.1.19.002。无令牌调用19e276f6-f877-4c24-9334-af33ce50fe66返回FORBIDDEN。此证据证明专用账号私网登录和空事务可用，不证明有业务行的写入、锁竞争、迁移完整性或支付完成。
临时database-probe验收后已执行精确DeleteFunction清理（6628c6d5-52e0-43ba-a7ad-4dfe38b83691），不删除专用账号和业务函数；后续回查删除状态另见工具结果。网络探针仍保留供后续业务传输诊断。主客户端未切换、订单/支付业务函数尚未部署，分账表及0023—0027迁移仍待审查/应用。下一步准备完整迁移和部署差异，继续资金写操作公网通道。

2026-09-24补充：0023—0027已在公司库执行并只读核验；am_payment对order_settlement_tasks的SELECT/INSERT/UPDATE现已补授，替代前文‘表不存在暂未授权’状态。

### 2026-09-24 占档实际锁权限故障修复及真实空事务验收
新增audit-company-slot-connection.js，先只读确认随机provider不存在，再向私网函数发出真实HMAC签名请求。发现此前探针未覆盖accounts FOR UPDATE，实际返回PERSIST/ER_TABLEACCESS_DENIED_ERROR（ff8c2da8-05af-41d6-860c-21739c61a992）；部署成功/订单空列表不能代替占档权限验收。
MySQL官方规则：https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html 。FOR UPDATE需要SELECT之外的UPDATE/DELETE/LOCK TABLES之一；8.0.22起FOR SHARE仅需SELECT。不能因普通读取可用推断排他锁权限。先前尝试数据库级LOCK TABLES被自动审批拒绝，未执行。改为独立provider_slot_locks表（0028迁移，仅provider_id主键和accounts外键），账号和资质使用FOR SHARE；锁表INSERT ON DUPLICATE KEY UPDATE持有服务方互斥行锁，既有订单行锁/版本判断不变。
0028已在公司库创建；精确表级授权第一次仍被自动审批拒绝，权限前置条件未满足时函数部署也被拒绝，均未执行。随后用户明确批准am_order@172.17.0.0/255.255.240.0对该表SELECT/INSERT/UPDATE，授权成功后修复部署进程38188完成exit0。仅扩展该表权限，没有全库LOCK TABLES；SHOW GRANTS真实回查accounts/qualification仍仅SELECT、order_aggregates SELECT UPDATE、新锁表SELECT INSERT UPDATE，无DELETE/DDL/GRANT OPTION。数据库和固定IP/NAT配置未改变。
真实云空事务验收成功2026-09-23T21:41:58.304Z：合法签名进入数据库后PROVIDER_NOT_AVAILABLE，篡改body被拒绝，请求4b39f503-08f8-49a7-9e10-2b2adf360c7b与888e904b-31c3-4194-9ba2-412c4ab507a6。结果保存在.artifacts/company-slot-connection-audit.json。订单与锁表计数均0，未写业务行；只证明私网函数签名+空共享锁读取+回滚，未证明真实用户跨公网函数确认已有订单。
本地真实MySQL新增受限账号验收，覆盖精确权限下并发占档成功一个、仍拒绝修改账号/资质。支付预留、预支付与分账准备中只读商户锁改为FOR SHARE，新增受限付款账号验证这些流程可执行且商户UPDATE被拒绝。87项支付单测、68项数据库集成通过；支付改动尚未部署、微信接口仍测试替身。本地测试账号/随机数据库清理，MySQL shutdown成功。后续继续真实双角色占档与支付资格/公网POST/通知/分账全链路，不标记正式上线完成。

### 2026-09-24 公司资金互斥迁移已落地，权限待明确批准
0029已在公司数据库建表，真实只读结构复核ok=true、orders/payments/settlements=0；覆盖前文“0029尚未迁移”。am_payment对新表SELECT/INSERT/UPDATE尝试被自动审批拒绝，未执行，已询问用户具体授权。不得扩大或绕过；其他开发继续。
本轮迟到NOT_FOUND不覆盖已核实的分账结果，已受理却查不到时报冲突；97支付单测/94本地MySQL集成通过，非真实资金验收。详见checkpoint最新条目。

### 2026-09-24 用户批准后资金互斥精确授权完成
用户明确批准am_payment现有172.17.0.0/20私网来源对order_funds_interlocks的SELECT/INSERT/UPDATE。已执行成功，并真实SHOW GRANTS回查：新表恰为SELECT/INSERT/UPDATE，账号/身份/角色/商户表仍仅SELECT，order_aggregates仍SELECT/UPDATE，payments和settlement_tasks仍SELECT/INSERT/UPDATE；无DELETE、DDL、全库数据权限或GRANT OPTION（USAGE仅账号存在，不授予数据访问）。新资金锁表COUNT=0。
此条替代前文“授权等待用户批准”；自动审批拒绝已在明确授权后解除，不需再次询问该范围。此次仅权限和空表计数验收，未证明真实私网函数的资金互斥写事务，未部署支付或执行付款。继续受限账号/云端运行验证与剩余支付上线事项。

### 2026-09-24 最小权限运行验证及凭据轮换
本地新增真实受限账号测试：仅按am_payment实际表级权限执行分账资金锁及退款/争议登记，确认不能DELETE资金锁或UPDATE商户资格；95项隔离MySQL集成及3项探针单测通过，本地MySQL已shutdown。临时database-probe新增新表读取与空锁回滚，公司调用c07c1c53-0f0e-4220-8d58-d83dc3a17c70成功。此为读取/空事务证据，不是云端业务写入或真实资金验收。
安全事件：清理检查时一次GetFunction原始输出意外包含探针环境变量（数据库凭据与令牌），未将值复制到文档/源码。已即时告知用户，轮换am_payment和am_order两个现有私网账号密码、更新受忽略.cloudbase-cli-config相关原始及B64配置、轮换DATABASE_PROBE_TOKEN；root、权限、商户密钥、联系信息加密密钥和业务数据不变。旧密码由ALTER USER替换；仅更新已部署order-slot-confirm的凭据，主order-api不含数据库密码，无需改。所有后续GetFunction只输出过滤后的状态/布尔值，禁止再次原样输出环境变量。
轮换后临时探针调用dcaea158-7762-4eed-a229-850627d30197成功：两个账号identity/databaseMatched、所需新旧表读取、空事务回滚、mysql.user越权拒绝均通过。占档重新部署进程32700完成exit0，audit-company-order-deployment.js两函数Active且所有配置匹配。真实占档空事务复验2026-09-23T22:31:03.676Z成功，请求9541b760-a70d-43dd-bd20-67e56e71960b/c2086852-92ab-43f6-8ffb-d61dd8a55a0c，签名进入数据库、随机不存在服务方拒绝、篡改拒绝、无业务写入。
第二次临时探针删除请求0331136c-378c-4400-aa17-8971bb4b0c5a已受理，最终状态见本轮后续核对。部署支付资金功能、退款完整流程、防重放、产品资格、真实验收和正式上线仍未完成。不得将此安全修复/空事务通过等同支付跑通。

最终清理核对：SCF GetFunction(database-probe)返回ResourceNotFound.Function，确认第二次临时探针已经删除；不存在待轮询部署任务。

### 2026-09-24 防重放0030已迁移，最小授权待回复
公司0030表已创建且为空，结构复核通过，业务记录计数全0；am_payment仅INSERT精确授权问题已发出，尚未执行。详见payment-replay-guard-deployment-plan-2026-09-24.md。
提交relay上限12秒、任务剩余预算>14秒，104单测/100本地DB集成通过；真实跨服务时限未验收，资金仍关闭。其他商户/退款/回调/真实分账上线待办不变。

### 2026-09-24 通知数据库账号、双函数部署及真实只读验收
公司只读确认通知账号/0031表均不存在后迁移0031_order_notification_receipts成功，仅新增空表。新增apply-company-notification-account.js，固定公司环境、专用账号/私网范围、五表权限，密码只读忽略配置且不输出。执行89234成功；2026-09-24T03:49:00.881Z SHOW GRANTS严格比对通过：am_notification@172.17.0.0/255.255.240.0，accounts/wechat_identities/order_aggregates/wechat_subscription_events仅SELECT，order_notification_receipts仅SELECT/INSERT/UPDATE，另仅USAGE，无其他权限。证据.artifacts/company-notification-account.json。不得重复运行--apply；已有账号将拒绝继续。
部署私网23177、公网1674均成功exit0。使用上一轮独立包/配置，无触发器，公网发送开关false，不含数据库密码；私网专用账号接现有VPC。2026-09-24T03:51:57.501Z全表权限脚本通过，当前33张表均ADMINONLY，存储PRIVATE。
新增audit-company-notification.js，真实32048于2026-09-24T03:52:45.833Z通过13个检查：两函数Active/handler/无触发器/配置匹配，公网关闭及无数据库凭据；合法签名recheck实际私网SQL空查询返回ok:true/data:false，篡改签名拒绝，公网关闭入口拒绝。未请求claim/record/dispatch，不写业务数据、不发送消息。证据.artifacts/company-notification-deployment-audit.json。证明实际数据库连接及读取路径，不是跨函数调用、收据INSERT/UPDATE或真实通知验收。
下一步仍需订单持久事件触发、跨函数读取/签名联调、真实用户订阅推送落库、发送额度/送达/回跳及页面完整实屏；发送不能盲目开启。依赖5项通告仍待专项处理。当前无待观察进程，正式上线目标active。
