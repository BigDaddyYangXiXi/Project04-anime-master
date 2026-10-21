# 新公司订单与支付数据库接入核查

目标环境：`cloudbase-d2g65rqbvee0bd978`。本记录只包含核查与待执行方案，不代表已配置或已验收。

## 已核实

### 最新支持回复：2026-09-23 09:47:30

后续已完成[两条接入路线比较与源码影响核查](database-access-options-2026-09-23.md)。保留库的受限私网方案与统一迁至 TLS 候选库并列评估，不能把前文“核验 TLS 候选”理解为已经决定迁库。费用、安全取舍及目标实测未完成，未授权购买或降级连接策略。

来源：用户转贴工单 202609238321 工程师消息，本轮未独立刷新后台。当前数据库不支持 SSL/TLS、只有标准版云函数支持 VPC、公网函数直接请求微信支付等公网 API 无需 VPC 或 NAT。这替代此前个人版 VPC 与申请 CA 的说法；下文旧验证顺序为历史，不再执行“为本实例申请 CA”。

payment-api/index.js 和 order-api/slot-runtime.js 的 mysql2 连接均强制证书和主机身份校验，不能靠填写配置接通无 TLS 的服务端。升级函数套餐只涉及 VPC 权益，不能据此推断数据库支持 TLS。

下一步：核验支持 TLS 与原生 MySQL 事务的接入候选、表结构／权限、迁移回退及实际费用，未确定目标或授权购买。私网无 TLS 是需明确评估的安全取舍，不把 VPC 等同传输加密，不自动修改现有策略。

工程师第 3 点仅确认公网函数到微信的出网，尚未确认 VPC 内函数到公网函数的调用路径、鉴权、重试和费用。微信接口仍用 HTTPS，不能把回复中的“HTTP 请求”理解为明文支付。未变更运行代码、连接凭据、套餐或云资源。

- 基础三个函数部署且四项只读调用通过，账号、身份、作品、订单、支付记录仍为零。
- 官方函数详情：`account-api` 为 Active/Available，Nodejs20.19；VpcId/SubnetId 为空，公网出口开启，固定出口 IP 未启用。
- 数据库设置实屏：直连服务开启，仅内网 `172.17.0.13:3306`，外网关闭；VPC `vpc-fw6hzw6m`，子网 `subnet-ofbei8gl`。只有 root 账号，平台不提供其密码；页面提供新建应用账号入口。
- 连接管理列表为空；该页面不是已配置的应用连接凭证。
- 自动暂停仍为开启、30 分钟，最大 0.5 核 / 1GB。未修改这些配置。
- 加密状态 API 曾返回 `UnauthorizedOperation.PermissionDenied`，拒绝操作 `cynosdb:DescribeSSLStatus`；请求号 `239c2744-9578-4691-aff5-69f2fd933c37`。不能据此判断 SSL 已关闭，不能以升级套餐保证解决这项权限问题。

## 接入方案与验证顺序

1. 确认数据库所属管理员可管理该集群的 SSL，取得可信 CA 和证书匹配的连接地址。保留 `rejectUnauthorized:true` 与 `verifyIdentity:true`。
2. 核对环境能否为订单／支付函数配置上述 VPC 和子网。当前配额制个人版不包含云函数 VPC 能力；官方标准版参考价 199 元/月。升级须以实际购买页能力和费用为准，尚未批准或购买。VPC 下支付访问微信接口的出网条件也须核验，不能只验证数据库可达。
3. 创建分别用于占档和支付的应用账号，限定业务库及必要表权限；不使用 root、不授予结构修改权限。占档读取 accounts、provider_qualifications、order_aggregates 并更新 order_aggregates；支付读取 accounts、wechat_identities、provider_payment_merchants、order_aggregates、order_payments，按实际调用需要插入／更新支付和更新订单。锁读需要的权限以 MySQL 版本和实测为准。
4. 将独立凭证配置给对应函数。先只读检查加密连接、数据库名、可见表及账号权限，再申请隔离数据的事务联调；当前新库保持空数据。
5. 事务验证须覆盖并发占档只有一笔成功、失败回滚、支付重复通知与金额身份校验，再进入双账号真机验收。

未开放公网数据库、未降低 TLS 校验、未授予新权限、未创建新账号、未部署订单／支付。

## 官方依据

- 配额制能力与价格：https://cloud.tencent.com/document/product/876/75213
- 数据库直连说明（内网云函数须启用 VPC，外网适用开发调试）：https://docs.cloudbase.net/en/database/configuration/db/tdsql/direct-connection

一般集成文档含“自动内网直连”描述，但不能据此覆盖当前函数 VPC 为空的实查结果；最终必须以目标函数实际连接验证为准。

## 2026-09-23 TDSQL-C 管理受限与数据库运行状态分离

用户报告“当前状态不允许操作集群”。公司官方 CLI 实查目标实例 Status=running、ServerlessStatus=resume、IsFreeze=yes、ProcessingTask 为空、Tasks=[]。随后只读 SELECT 1 AS connection_ok 成功返回 1，排除当前数据库完全不可查询的判断。IsFreeze 是冻结标记，但接口未提供冻结原因；不得推断欠费、暂停、AppID 切换或升级套餐即可解除。

TDSQL-C 主账号网页已在上海，列表可见目标集群且为“运行中”，详情地址却退回 no-cluster/detail 并显示“当前地域下无对应集群信息”。底层管理受限尚未解决；不再要求用户反复点同一实例，也不尝试强制解冻或重启。后续管理优先沿 CloudBase 自带数据库设置入口确认支持范围；TLS 权限和冻结原因需平台明确，VPC 套餐能力是另一独立条件。未购买、未改配置、未写业务数据。


## 2026-09-23 事务官方能力确认，技术支持工单已准备

官方 FAQ https://docs.cloudbase.net/database/configuration/db/tdsql/faq 明确 CloudBase MySQL SDK 不支持事务，原生 mysql2 管理连接与事务是官方路径；不能以普通 app.rdb() 多次写入替代现有原子占档。官方云函数 MySQL 接入步骤仍要求选择数据库所在 VPC，且提醒配置 VPC 后公网访问须额外核对。迁移至自有账号文档不能直接套用：本实例控制台已显示“自有实例”，没有证据要求重建迁移。

平台尚未公开说明本实例 IsFreeze=yes 及 DescribeSSLStatus 权限拒绝的具体原因。已形成可审核工单 product-records/cloudbase-support-request-2026-09-23.md，询问管理限制、TLS CA/主机名、最小套餐和内外网费用，以及应用账号权限配置。因向腾讯云客服发送信息需要明确授权，已请求仅批准提交诊断工单；尚未提交，不包含任何密钥，不授权变更或购买。
