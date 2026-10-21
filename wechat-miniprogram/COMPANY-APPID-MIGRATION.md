## 2026-09-23 03:09:28 三项补充请求已入单

用户明确批准三项追加请求后，工单 202609238321 当前页面已显示用户消息（03:09:28）：申请 CA/证书匹配地址/TLS 状态，核实个人版 VPC 权益与公开价格表差异，确认无 NAT 的跨函数调用路径和费用。消息明确不授权购买或修改资源。发送按钮调用曾超时并提示已禁用，随后读取实际历史确认消息已存在、编辑框已清空，因此不重复发送。暂无针对该追加消息的技术答复。

等待期间继续已授权且独立的页面切换白闪待办；不擅自制定取消／超时释放规则，不改变云端部署和计费。

## 2026-09-23 03:04:51 腾讯云技术回复与待核实项

工单 202609238321 当前“处理中”。工程师明确：IsFreeze=yes 为云开发托管保护，非欠费，无需解除；实例已在用户账号下，无需迁移，管理应走 CloudBase。TLS CA 需通过工单申请。工程师称本环境个人版可配置 VPC、无需升级；与之前公开配额表冲突，尚未实测，不宣称网络已接通。支付公网访问建议 NAT（付费）或拆分函数（称无额外网络费），未采纳或部署。其 TLS 示例 checkServerIdentity 返回 undefined，不验证主机名，未采用。

准备追问：申请该实例 CA、匹配证书 SAN/CN 的可解析主机名及 TLS 当前开关状态；明确本环境个人版 VPC 权益与公开价格表差异；明确拆分后 VPC 函数到公网函数的官方调用通路及费用。只申请资料，不授权资源变更。

尝试填写补充回复被自动审批拒绝，理由为原工单授权不覆盖此具体追加消息外发及其中环境／连接信息。未发送，不能换方式绕过；将向用户申请这条具体追加回复授权。当前仍可推进白闪等不依赖云端的待办。

## 2026-09-23 腾讯云支持工单已提交

用户明确批准代提交，随后自行补齐联系电话。通过腾讯云官方工单中心选择“云开发 CloudBase / 云开发-数据库”，填写目标环境、诊断证据及五项问题，提交成功。当前回执工单号 202609238321，页面状态“已建单”，创建时间 2026-09-23 02:52:29。仅有系统保密提醒，尚无技术诊断答复；不能将自动提醒称为工程师已解决。

工单明确仅诊断与建议，不授权解冻、重启、迁移、重建、套餐升级、付费开通或开放公网。未提交密钥，不在本地记录用户手机号。后续阅读回复后核对官方处理步骤及费用再推进。现有数据库和部署范围未改变。

## 2026-09-23 事务官方能力确认，技术支持工单已准备

官方 FAQ https://docs.cloudbase.net/database/configuration/db/tdsql/faq 明确 CloudBase MySQL SDK 不支持事务，原生 mysql2 管理连接与事务是官方路径；不能以普通 app.rdb() 多次写入替代现有原子占档。官方云函数 MySQL 接入步骤仍要求选择数据库所在 VPC，且提醒配置 VPC 后公网访问须额外核对。迁移至自有账号文档不能直接套用：本实例控制台已显示“自有实例”，没有证据要求重建迁移。

平台尚未公开说明本实例 IsFreeze=yes 及 DescribeSSLStatus 权限拒绝的具体原因。已形成可审核工单 product-records/cloudbase-support-request-2026-09-23.md，询问管理限制、TLS CA/主机名、最小套餐和内外网费用，以及应用账号权限配置。因向腾讯云客服发送信息需要明确授权，已请求仅批准提交诊断工单；尚未提交，不包含任何密钥，不授权变更或购买。

## 2026-09-23 TDSQL-C 管理受限与数据库运行状态分离

用户报告“当前状态不允许操作集群”。公司官方 CLI 实查目标实例 Status=running、ServerlessStatus=resume、IsFreeze=yes、ProcessingTask 为空、Tasks=[]。随后只读 SELECT 1 AS connection_ok 成功返回 1，排除当前数据库完全不可查询的判断。IsFreeze 是冻结标记，但接口未提供冻结原因；不得推断欠费、暂停、AppID 切换或升级套餐即可解除。

TDSQL-C 主账号网页已在上海，列表可见目标集群且为“运行中”，详情地址却退回 no-cluster/detail 并显示“当前地域下无对应集群信息”。底层管理受限尚未解决；不再要求用户反复点同一实例，也不尝试强制解冻或重启。后续管理优先沿 CloudBase 自带数据库设置入口确认支持范围；TLS 权限和冻结原因需平台明确，VPC 套餐能力是另一独立条件。未购买、未改配置、未写业务数据。

## 2026-09-23 订单支付网络条件核实，实例页待手动切地域

实查 account-api Active/Available，VpcConfig 的 VpcId/SubnetId 均为空；数据库设置仍仅内网 172.17.0.13:3306，外网关闭，只有 root，未创建应用账号。官方配额制文档个人版不支持云函数 VPC，标准版参考 199 元/月；不能以此保证升级解决此前 TLS 查询权限拒绝，未购买。具体接入步骤、权限范围与验收条件已整理至 product-records/company-db-connection-2026-09-23.md。

通过数据库设置的“跳转实例”已打开腾讯云 TDSQL-C 控制台，显示公司主账号已登录，但默认广州。自动点击地域文字与容器均返回 Input.dispatchMouseEvent 超时；首次失败后实查页面未展开菜单。已请用户仅手动切上海并打开 cynosdbmysql-3108fb6o，先不购买或改配置。未请求重复登录，不假称 SSL 或网络已解决，未扩大部署范围。

## 2026-09-23 三个基础业务服务已部署，只读云端验收通过

用户明确批准 account-bootstrap、account-api、catalog-read 部署及只读验收。官方公司 CLI 在 cloudbase-d2g65rqbvee0bd978 部署三个函数，全部成功，远端安装依赖。首次因 CLI 拼接 Windows 绝对 functionRoot 路径而全部跳过；配置改为项目相对 cloudfunctions 后成功。未扩大函数范围。

开发工具当前 AppID wxc94e1c1b38944511 已校验，automation/company-foundation-runtime-audit.js 实际执行通过四项：getSession 返回 registered=false；getMine 返回 ACCOUNT_NOT_FOUND；listProviders 返回空列表；listDiscovery 返回空列表、total=0、nextCursor=null。发现查询脚本补齐项目规范的城市编码 310000，仅作只读参数，不保存用户城市；服务端代码未变。最初调用失败后身份探针复验成功，后续完整四项成功。

验收完成后管理 SQL 复核 accounts、wechat_identities、works、order_aggregates、order_payments 均为 0。客户端 enabled=false 已核对；未创建账号／作品／订单，未上传发布，未购买套餐，旧环境未操作。本轮证明真实新云的基础读取链路，不代表注册写入、手机号授权、订单／支付事务、媒体权限或真机验收通过。后续订单／支付仍需解决此前记录的 TLS 查询权限、应用账号和网络条件。

## 2026-09-23 基础业务服务部署准备完成，待扩展部署批准

独立公司密钥已生成并保存于被 Git 忽略的 wechat-miniprogram/.cloudbase-cli-config/company-business-secrets.json；未输出值，未沿用旧环境密钥。部署配置 company-foundation-deploy.json 仅含 account-bootstrap、account-api、catalog-read，手机号 HMAC 密钥仅配置给 account-bootstrap。未部署这三个函数，客户端仍 enabled=false，未购买、上传或发布。

账号身份、手机号适配、账号资料和公开目录相关测试 38/38 通过。新增 automation/company-foundation-runtime-audit.js，语法通过；计划从开发工具核验 getSession 未注册、getMine 拒绝未注册身份、公开列表与发现列表均为空，共四项只读检查。脚本尚未实际运行，不是云端验收证据。此前批准仅为 auth-probe，已请求扩展到这三个业务函数及只读验收。

订单／支付直连的 TLS 状态查询被腾讯云拒绝：cynosdb:DescribeSSLStatus 返回 UnauthorizedOperation.PermissionDenied，请求号 239c2744-9578-4691-aff5-69f2fd933c37。未改变权限、未绕过拒绝、未关闭证书验证。基础服务经 app.rdb() 接入的验证可独立推进；不能把管理 SQL 成功或本地测试当作事务直连成功。后续仍需解决可信 TLS、应用数据库账号与函数网络，并核验剩余表／存储权限。

# 公司主体小程序迁移

用户指定新 AppID：`wxc94e1c1b38944511`。原 AppID：`wx57412ad07a806b70`。

用户原先要求先跳过云开发；2026-09-22 已明确“确认 继续”，解除新环境暂缓，开始核对和准备接入。具体付费套餐仍需确认，未批准发布上线。完整页面、资源和业务源码保留，客户端云连接在目标核实前继续关闭。不代表完整云端迁移或账号数据转移已经完成。

## 2026-09-23 最新核验

**身份链路已通过：**用户批准后，仅 auth-probe 已通过微信官方 CLI 部署到新环境；当前开发工具真实调用成功。runtime audit 同时校验实际 AppID 为 wxc94e1c1b38944511、新环境与部署配置一致，返回 authenticated=true。本地探针审计 2/2 通过。其余业务函数未部署，未上传／发布小程序，客户端仍关闭；不把探针成功记为完整登录注册、订单或支付已接通。下方未部署记录为此前阶段状态。

用户最新决定：**新号从空数据开始**。旧账号、作品、图片与订单不复制，旧环境保留不删除；无需旧身份关联或旧加密密钥迁移。新服务接入应使用独立密钥和身份，不能让本地演示数据进入新库。已补充实查 order_payments 的权限为 ADMINONLY。

**数据库最新状态：**用户已手动创建 MySQL 8.0；CLI 确认运行中，SQL 读取成功，表名不区分大小写。新空库现已按序执行 0001—0022 全部迁移，27 张 InnoDB 业务表、27 主键、29 外键、55 CHECK、21 唯一约束复核通过；账号／订单／付款／审核记录均为空。无旧数据复制、无云函数部署。不能再次全量执行这些非幂等 ALTER 迁移。

公司库迁移命令使用 `node scripts/run-cloudbase-sql-migration.js <新环境ID> <迁移文件> --company`，启用公司独立登录并拒绝与 cloudbaserc.json 不一致的目标。旧入口默认登录未改。

连接前置条件仍未完成：集群 cynosdbmysql-3108fb6o 当前只开放内网 172.17.0.13:3306，VPC vpc-fw6hzw6m/subnet-ofbei8gl；没有为应用创建数据库账号，未开外网。订单原子占档和支付的 mysql2 连接需要可信 TLS 及可达网络，不能仅凭 app.rdb()/管理 SQL 成功就宣布接通。自动暂停保持开启；两项已查表权限为 ADMINONLY（account_discovery_preferences、order_aggregates），不代表全部表的运行权限验收。

腾讯云网页登录完成。实际控制台显示「微信体验版」，有效期至 2027-03-23 23:59:59；套餐明细为 3GB 容量、20万次调用、15万 CU 计算额度等，虽然同页能力摘要显示资源点，CLI 判定非资源点计费，应以具体配额及账单核验为准。官方配额制价格文档说明计算资源包含 MySQL，免费环境不支持开启按量付费；小程序发布会影响免费期，不将页面当前到期时间保证为上线后免费截止日。依据：https://cloud.tencent.com/document/product/876/75213 。

MySQL 开通页面已核对：MySQL 8.0、默认 VPC／子网、表名不区分大小写；个人版默认自动暂停。点击“立即开通”被自动审批检查拒绝，理由为创建数据库可能产生持续费用且表名大小写选项不可逆，现有授权未明确包含创建。该动作未执行，未用 CLI 绕过。已向用户发出明确确认：仅在当前免费套餐内创建，不升级、不启用额外按量付费，若需购买则停下。等待答复。

已确认新公司环境 `cloudbase-d2g65rqbvee0bd978`，名称 `cloudbase`：公众平台显示已开通，开发工具官方 CLI 环境查询返回同一 ID，原 ret=1000 错误已消失。官方 CLI 云函数列表查询成功，返回空列表。用户反馈套餐为「个人版，开发期免费」，有效期及数据库能力尚未核验。

本地 `cloudbaserc.json` 和客户端 `config/cloudbase.js` 已登记新目标，客户端保持 `enabled:false`；AppID／两处环境 ID／关闭状态一致性检查通过。未部署或执行数据库迁移。下方“配置仍指向旧环境／环境 ID 为空”为历史状态，以本段为准。

原 CloudBase CLI 登录无法查询该新环境（DescribeEnvInfo: env not found in list），因此新增 `scripts/cloudbase-company-cli.js`，使用已忽略的 `.cloudbase-cli-config/company/` 独立保存公司授权，旧登录保留。公司授权已成功；`env detail` 确认目标环境 NORMAL、ap-shanghai、个人版、miniapp 来源。`db instance list` 返回 total=0，当前没有 MySQL 实例，不能直接迁移现有关系表。配额查询显示该环境不采用资源点计费，不能用该命令推定免费期时长。腾讯云网页仍需单独登录，已请求管理员扫码，接着核验 MySQL 开通与具体费用；未创建数据库或购买套餐。

管理员已扫码登录。当前后台显示名称「ArsViora万匠屋」，页面服务市场链接所带 AppID 为 `wxc94e1c1b38944511`，微信认证已完成。备案当前显示平台驳回；用户明确由本人处理，开发侧不进入或操作备案流程。后续范围为云开发环境核对和迁移准备。

内置浏览器导航、点击、读取和截图已恢复，微信公众平台当前为真实扫码登录页，等待管理员完成新公司账号登录。开发工具缺失的 `.ide` 登记已修复，官方 CLI 登录状态为 true；公司项目云环境列表两次返回服务端 `ret=1000, system error.`，尚未取得新环境 ID。不能将此错误认定为未开通，也不改用旧环境。登录后核对公司 AppID、云开发实际状态、资源归属、MySQL 能力和具体费用，再确定接入动作。此前插件故障不再作为内置浏览器无法操作的理由。

## 2026-09-22 接入核对（历史）

- 当前 CLI 登录账号、上海区域的环境列表只返回旧环境；没有新公司目标的归属证据。此结果不覆盖其他账号／区域。
- 电脑操作插件缺少文档接口，浏览器插件引用的运行文件缺失，无法代操作公司后台。已请求用户提供新公司云开发页的环境 ID，或开通页套餐名称和价格。套餐查询命令未取得价格，未选择套餐、未创建资源。
- 现有代码依赖 CloudBase `app.rdb()` 和 MySQL，原子占档及支付还需同库的可信 TLS 连接。开通前核验目标支持这两种访问；不能把 PostgreSQL 或仅有文档数据库当成可直接替代的目标。
- 14 个函数：auth-probe、account-bootstrap、account-api、catalog-read、provider-catalog-draft、media-upload、order-api、project-api、availability-api、saved-items-api、media-security-submit、media-pending-cleanup、wechat-message-callback、payment-api。
- 新空库需逐项审阅并按顺序应用 `database/mysql/0001` 至 `0022` 共 22 个 SQL 文件；已有库先核对迁移记录，不能重跑全量。历史数据／账号关联的保留范围尚未确定，当前不复制旧业务数据。
- 配置名称已从源码核对：`ACCOUNT_PHONE_HASH_KEY`、`ORDER_CONTACT_ENCRYPTION_KEY`、`ORDER_MYSQL_CONFIG`、`PAYMENT_MYSQL_CONFIG`、`PAYMENT_WECHAT_CONFIG`、`TENCENT_MAP_KEY`、`WX_CALLBACK_TOKEN`、`WX_CALLBACK_AES_KEY`。这里只登记名称，不读取或保存秘密值；按各函数使用范围配置。
- `utils/local-preview.js` 当前强制开发工具、开发版与体验版走本地预览。仅填环境 ID 不会完成真实云联调；目标确认后须建立明确的真实联调模式并验证登录、双身份及无预览数据混入。

执行顺序：核实公司资源归属与费用 → 核对 MySQL 能力和迁移目标 → 数据与存储权限、配套函数及回调配置 → 真实身份与媒体验证 → 支付权限和双账号交易联调。每一步以真实环境结果记录，不用本地预览代替。

## 已处理

- `project.config.json` 改为新 AppID，保持现有项目目录、版本、编译设置及云函数源码目录。
- `miniprogram/config/cloudbase.js` 保持 `enabled:false`，环境 ID 已登记为新公司环境，数据库与配套服务就绪前不启用。
- 原云环境 `quest-band-d1gem4bxt3fa17720` 未更改、未删除。部署配置 `cloudbaserc.json` 已登记新环境；公司操作使用独立的 `scripts/cloudbase-company-cli.js`。既有维护脚本仍须逐项核对目标和登录身份，不能默认使用旧登录执行迁移。
- 旧文档、测试样例和历史证据中的原 AppID 保留，不通过全局替换伪造迁移历史。

## 后续接入

新环境开通后再确定是关联现有独立CloudBase资源，还是迁移至公司名下新环境；先核验资源归属和关联资格。核对云函数、MySQL结构及业务数据、存储文件及引用、配置密钥、消息回调、内容审核、手机号能力和支付配置，再启用真实云连接。

账号实现当前以微信可信身份查询关联，不能把旧小程序的身份值当成新程序用户直接覆盖。若需要保留旧账号和订单归属，须另行完成可信账号关联验证。手机号指纹及订单联系方式所用密钥需要在迁移时保持正确对应，不能以新生成密钥冒充旧数据解密能力。

本轮未部署云函数、未迁移数据库、未上传或发布新小程序；未验证新AppID下的真实授权和云端流程。开发版原有本地预览不等于公司小程序云端已接通。

配置依据：[CloudBase 小程序关联说明](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)。

## 2026-09-23 17:06 公司全表与存储权限实查

A03 配置层证据更新：SHOW TABLES 返回 27 张实际业务表；DescribeResourcePermission 返回完全匹配的 27 条 table 规则，全部 ADMINONLY。storage rules get 为 PRIVATE、rule=null（仅创建者和管理员读写）。policy list 返回空列表，未将其误解为放行或拒绝证据。无权限改写、数据读写或公开链接生成。

新增 wechat-miniprogram/scripts/company-permissions-readonly.js，固定校验公司 AppID／env，一次只读取得真实表清单并核对返回集合、数量、权限与存储规则；2026-09-23T09:06:13Z 实际执行通过。它不读取业务行数据，不输出登录凭证。当前仍 27 表，不包含本地尚未迁移的 0023/0024。

范围限制：管理配置证据不能替代普通微信身份直接读取／写入拒绝、双方猜 ID 越权及私有文件下载验收；未证明全部函数内部授权和已签发 URL 撤销行为。A03 保持部分完成。部署现状为七函数（探针、三基础、项目／收藏／档期），客户端仍 enabled=false。

## 2026-09-23 默认云命令公司身份修正与实时函数清单

A04/A05：package.json的cloudbase与cloudbase:envs此前仍调用旧登录目录wrapper；现改为cloudbase-company-cli.js。公司wrapper在SDK加载／os.homedir改写前检查固定公司AppID、新envId和客户端env一致，错配立即停止。旧wrapper仍作为历史文件保留，不作为默认命令；没有删除或读取旧凭据，没有迁移旧数据。此校验保障仓库默认配置，不声称阻止所有显式命令行环境覆盖。

company-cli-target.test.js 2项通过，覆盖正常公司目录和三种错配均不加载CLI；实际--version返回CloudBase CLI3.8.1。随后真实只读fn list --json成功：auth-probe、account-bootstrap、account-api、catalog-read、project-api、saved-items-api、availability-api、provider-catalog-draft、media-upload、wechat-message-callback共10个函数均Deployment completed。探针仍Nodejs16.13，其他9个Nodejs20.19；未变更运行时或重新部署。

当前仍缺order-api、payment-api、media-security-submit、media-pending-cleanup线上部署；回调公网入口待原批准，数据库安全连接和云预算未决、资质未通过、平台支付资格未落实。CLI清单不是函数业务验收，不能因此打开enabled=false或提交发布。私人参考图和交付下载等本地新增接口尚未上线。
