# CloudBase 部署准备

## 当前状态入口（2026-09-05）

非支付业务已接入真实 CloudBase；本地目标版本 `.9`，迁移文件至 `0017`。`.8`／`.9` 尚未上传／部署，order-api 的四项确认新契约须与新客户端配套验证，不能单独部署后让旧客户端提交缺字段请求。`.9` 付款分支修复不含微信渠道下单／查单或回调部署。以下按日期保留接入过程，早期“仍使用本地数据”等描述不代表当前状态。发布、证据和未完成项以 [工程基线与任务台账](../product-records/development-baseline.md) 为准；本文历史云端状态未在此次文档更新中重新验证。

## 接入阶段决策（历史）

在尚未购买云服务器的阶段，先使用 CloudBase 免费体验环境验证真实微信身份、云函数和 MySQL。小程序通过 `wx.cloud.callFunction` 调用普通事件云函数，服务端从 CloudBase 注入的可信调用上下文读取微信身份；不把微信身份字段交给业务页面，也不使用客户端传入的账号 ID 进行鉴权。

当前已接入可信身份探针、正式账号初始化、商家目录草稿、媒体审核、目录发布和已发布目录只读函数；账号、微信身份映射、双角色以及目录域结构已写入 CloudBase MySQL。订单、橱窗、作品等页面仍使用 `v063-store.js`，尚未切换为云端业务数据源。

当前腾讯云账号已有免费体验环境：`quest-band`，环境 ID 为 `quest-band-d1gem4bxt3fa17720`。该 ID 不是密钥，已经写入小程序配置；小程序认证和开发者工具真实调用已通过，`enabled` 已设为 `true`。

## 已完成的云端验收（2026-09-01）

- CloudBase CLI 已通过设备授权登录；项目使用被 `.gitignore` 排除的 `.cloudbase-cli-config/` 保存本地凭据，不修改系统 CloudBase 配置。
- 环境 `quest-band-d1gem4bxt3fa17720` 状态为 `Normal`，地域为上海，体验版到期时间为 2026-11-20 23:59:59。
- 普通事件云函数 `auth-probe` 已部署成功：Node.js 20.19、入口 `index.main`、256 MB、3 秒超时、无触发器、无网络配置。
- 首次 COS 上传因腾讯云解包未找到根目录入口而创建失败；改用 ZIP 直接上传并显式声明 `index.main` 后部署成功。可重复部署配置见 `cloudbaserc.json`。
- CLI 云端调用成功，耗时 5 ms；由于 CLI 不携带微信小程序上下文，函数按设计返回 `AUTH_CONTEXT_MISSING`。这证明服务端不会信任调用参数或伪造登录成功。
- CloudBase 已完成小程序认证，AppID 为 `wx57412ad07a806b70`，小程序名称为“冻鳗高手事务所”。
- 微信开发者工具已恢复运行，CLI 登录、项目打开、自动化 RPC 和首组 4 个核心页面路由均通过。
- 开发者工具中的真实小程序调用返回 `authenticated: true`；函数没有向客户端返回 `OPENID` 或 `UNIONID`。
- 真机开发版启动调用 `auth-probe` 已显示“真机身份验收：通过”；临时验收弹窗代码已在取证后移除。
- `miniprogram/config/cloudbase.js` 的 `enabled` 已设为 `true`。
- 返回值和日志均未包含 `OPENID`、`UNIONID`、SecretId、SecretKey 或临时令牌。
- CloudBase 内置 MySQL 8.0 实例已开通，首批迁移 `database/mysql/0001_identity_core.sql` 已创建 `accounts`、`wechat_identities`、`account_roles` 三张表，并保留唯一索引、外键、级联删除和角色检查约束。
- 普通事件云函数 `account-bootstrap` 已部署：Node.js 20.19、入口 `index.main`、15 秒超时。函数只从平台注入的微信上下文读取身份，使用确定性内部账号 ID 和幂等 upsert，同一用户重复调用不会创建重复账号。
- MySQL SDK 必须用 `SYMBOL_CURRENT_ENV` 初始化；`SYMBOL_DEFAULT_ENV` 会在当前 `@cloudbase/node-sdk 3.18.3` 的 RDB URL 构造阶段抛错。该故障已通过分阶段运行验收定位并修正。
- 开发者工具真实连续调用两次 `account-bootstrap` 已通过：两次返回同一内部账号，角色均为 `BUYER`、`PROVIDER`，响应不包含微信身份字段。
- 云端只读计数验收结果为：`accounts=1`、`wechat_identities=1`、`account_roles=2`，符合一个微信身份、一个内部账号、两个业务角色的预期。
- 已移除仅用于真机确认的一次性开发版弹窗，并重新生成干净预览包：628909 字节（614.2 KB），二维码见 `.artifacts/deployment/preview-qr.png`。
- 干净预览包已由用户在真机启动确认正常；账号初始化接入后的最终开发版真机验收通过。
- 第二批迁移 `database/mysql/0002_catalog_core.sql` 已创建目录域 9 张表：媒体资源、商家主页与标签、服务、作品与标签、作品图片、服务作品关联、置顶作品。云端反查结果为 `table_count=9`、复合外键列映射 `composite_fk_count=6`、检查约束 `check_count=13`。
- MySQL 目录结构用复合外键保证服务与作品属于同一商家、置顶作品属于对应商家，不依赖数据库触发器。迁移共 9 条 `CREATE TABLE IF NOT EXISTS`，本地结构审计通过，并可用 `scripts/run-cloudbase-sql-migration.js` 重复执行。
- 普通事件云函数 `catalog-read` 已部署：Node.js 20.19、入口 `index.main`、15 秒超时。仅支持 `listProviders`、`getProvider`、`getWork` 三个白名单动作，只返回正常账号下已发布的商家和作品。
- `catalog-read` 本地契约测试 3/3 通过；云端 `listProviders` 返回 `{ ok: true, providers: [] }`，未知动作返回 `INVALID_ACTION`。当前空目录是预期状态：没有把 C 端展示用的虚构商家数据写入真实用户环境。

## 商家目录草稿验收（2026-09-02）

- 发现并修正了“编辑草稿与公开目录共用一套记录”的建模风险：若直接开放写接口，未审核编辑会立即污染公开目录，或保存草稿时导致已发布橱窗下线。
- 第三批迁移 `database/mysql/0003_provider_catalog_drafts.sql` 已创建 `provider_catalog_drafts`，以账号为主键保存 JSON 草稿和乐观锁版本；编辑草稿与 `provider_profiles`、`provider_services`、`works` 公开表完全隔离。
- 普通事件云函数 `provider-catalog-draft` 已部署：只支持 `getDraft`、`saveDraft`；账号只能从 CloudBase 注入的微信上下文解析，客户端传入的 `accountId` 不参与归属判断。
- 本地草稿契约测试 5/5 通过，账号、目录回归合计 11/11 通过；覆盖可信身份、服务方角色、版本冲突、跨作品引用、重复 ID、作品图片最多 5 张和置顶最多 2 件。
- CLI 不携带微信上下文，云端调用按设计返回 `AUTH_CONTEXT_MISSING`；微信开发者工具通过临时 `--auto-port 9422` 执行真实身份只读调用，成功读取版本 `0` 的空草稿，响应不含 OpenID／UnionID。
- 验收后云端计数仍为 `provider_catalog_drafts=0`、`provider_profiles=0`、`provider_services=0`、`works=0`，确认只读验收没有创建空草稿，也没有把虚构商家数据写入真实环境。
- 草稿读写与发布均已开放；发布只接受当前账号精确草稿版本，并在服务、至少 3 件完整作品和本人 `READY` 媒体全部通过后生成公开快照。

## 媒体上传边界验收（2026-09-02）

- 普通事件云函数 `media-upload` 已部署，提供 `prepareUpload`、`commitUpload`、`cancelUpload` 三个白名单动作；上传路径只能由服务端按可信微信账号、用途和随机资产 ID 生成。
- 客户端上传后，服务端校验 fileID 必须属于当前 CloudBase 环境并精确匹配已签发路径，再通过 CloudBase Storage `getFileInfo` 的 HEAD 结果复核实际 MIME 和大小；当前仅允许 JPEG、PNG、WebP。单图上限已按微信 `mediaCheckAsync` 的官方限制收紧为 10 MB，避免产生无法进入内容安全审核的文件。
- 文件通过存在性、类型和大小校验后仍保持数据库 `PENDING`，接口只返回 `PENDING_SECURITY_REVIEW`，不会提前写成 `READY`。后续目录发布只能引用完成内容安全审核并转为 `READY` 的本人资源。
- 本地媒体契约测试 5/5 通过，连同账号、目录和草稿回归总计 16/16 通过；覆盖伪造环境、伪造路径、客户端 owner 注入、实际类型不符、超限文件、重复提交和取消清理。
- 微信开发者工具真实上传两次 1×1 PNG：签发、云存储上传、服务端 HEAD 校验、取消和云文件删除均完成。第一次长链路虽因自动化响应超时未返回，但云端状态已反查为完整执行；验收脚本已拆成六个短步骤，第二次稳定通过。
- 收尾反查：`media_assets total=2`、`deleted=2`、`active=0`、`ready=0`；对应用户 `work_image` 云存储目录返回 `total=0`。数据库保留两条 `DELETED` 审计记录，测试文件没有残留。

## 微信内容安全提交与回调服务验收（2026-09-02）

- 第四批迁移 `database/mysql/0004_media_security_checks.sql` 已创建媒体安全审核表，以资产 ID 为主键、微信 `trace_id` 为唯一键记录提交、审核和错误状态；回调只允许把仍为 `PENDING` 的资产更新为 `READY` 或 `REJECTED`，不会复活已经删除的资产。
- 普通事件云函数 `media-security-submit` 已部署。关系库和存储继续使用 `@cloudbase/node-sdk 3.18.3`；微信 OpenAPI 改由官方 `wx-server-sdk 4.0.2` 调用 `cloud.openapi.security.mediaCheckAsync`，解决通用 CloudBase SDK `callWxOpenApi` 在真实环境返回 102041 的问题。
- `security.mediaCheckAsync` 权限必须随云函数由微信开发者工具上传；仅用 CloudBase CLI 上传函数代码不会注册 `config.json` 中的 OpenAPI 权限。本次部署已通过微信开发者工具完成，结果为 `success=true`、`filesCount=8`、`packSize=17.7 KB`。
- HTTP 回调函数 `wechat-message-callback` 已部署至 `https://quest-band-d1gem4bxt3fa17720.service.tcloudbase.com/wechat-message-callback`。Token、EncodingAESKey 和 AppID 只保存在云函数环境变量与本机 DPAPI 加密临时文件中，未写入仓库或测试输出。
- 公网握手验证通过：正确签名 GET 返回原始 `echostr`，错误签名返回 403。公网安全模式 POST 验证通过：正确 AES 加密和消息签名返回 200／`success`，错误签名返回 403／`forbidden`；测试事件不是媒体审核事件，没有写业务表。
- 本地六组云函数契约回归共 32／32 通过；覆盖可信身份、目录、草稿、媒体签发／提交／取消、本人资产只读状态查询、OpenAPI 字段适配、回调验签解密、PASS／RISKY 状态映射、未知 trace 重试和已删除资产不复活。
- 用户确认公众平台消息推送配置已提交后，微信开发者工具以真实小程序身份重新上传 1×1 PNG。资产 `asset_178689b11fa54950923f2a574bde37c9` 于 2026-09-02 19:48:01（Asia/Shanghai）提交，19:48:06 收到微信异步回调并更新为资产 `READY`、审核 `PASS`、标签 `100`，全链路耗时 5408 ms。
- 首次查询暴露出状态脚本误用 `submitImage` 的缺口：已完成资产会被提交门禁正确拒绝为 `MEDIA_STATE_INVALID`。现已新增本人资产只读动作 `getImageStatus`，不再次调用微信 OpenAPI；`media-security-submit` 经开发者工具定向部署成功（8 个文件、17.9 KB），真实查询返回 `READY`。
- 两条自动化测试资产已通过本人鉴权的 `cancelUpload` 精确清理：数据库 `deleted_count=2`、`active_count=0`，对应云存储作品图片目录 `total=0`；本次 `PASS` 审核行和 trace 保留为审计证据，旧任务即使迟到回调也不能复活已删除资产。
- `wx-server-sdk 4.0.2` 当前仍带来 1 个中危、5 个高危传递依赖告警。本轮仅部署到免费开发验收环境；在生产发布前必须跟进微信官方运行时／SDK 修复版本并重新审计，不把当前结果表述为生产安全放行。
- 微信官方“消息推送”文档明确要求在小程序管理后台填写 URL、Token、EncodingAESKey 后点击“提交”，平台才发起 GET 验证并使配置生效。另一个 `tcb/setcallbackconfig` 接口只用于 CloudBase 云函数／云托管回调配置，明确不支持云调用且需要服务端 `access_token`；它不能安全替代本项目现有 URL 配置。本项目未引入 AppSecret 或额外 access_token 获取链路。

## 过期待审核媒体自动清理验收（2026-09-02）

- 新增系统事件云函数 `media-pending-cleanup`：未提交上传超过 2 小时、已提交但仍为 `PENDING` 超过 24 小时才可清理；每次最多处理 100 条，不接受客户端指定时间或批次大小。
- 函数拒绝携带 `WX_OPENID`／`OPENID` 的小程序用户调用；真实开发者工具调用已返回 `CALLER_NOT_ALLOWED`。人工运维验收只能指定格式合法的单个 `assetId`，避免一次手工调用扫描整批用户数据。
- 本地专项测试 5／5 通过，覆盖双过期门槛、批次与重复运行幂等、精确单资产、存储删除失败不写 `DELETED`、拒绝用户调用；连同其他六组云函数的完整契约回归为 37／37。
- 云函数为 Node.js 20.19、30 秒超时，当前状态 `Active/Available`。定时触发器 `hourly-media-pending-cleanup` 已启用，七字段 Cron `0 15 * * * * *` 表示每小时第 15 分执行；按阈值筛选，不依赖时区解释日期边界。
- 真实验收创建并提交 1×1 PNG `asset_aaefc150e0d14217b7a2fe8a0c58a63b`，仅将该测试记录回拨 25 小时。系统精确调用返回 `scanned=1`、`eligible=1`、`deleted=1`、`failed=0`，数据库反查为 `DELETED`，测试账号作品图片目录 `total=0`；再次精确调用返回全 0，云端幂等通过。
- 官方版本复核结果：`wx-server-sdk` 稳定 `latest=4.0.2`，`@cloudbase/node-sdk latest=3.18.3`。较新的 `release-v3=3.18.5`、`next=4.0.3` 和 `wx-server-sdk beta=4.0.3-beta.1` 仍引用旧 Axios／CloudBase 依赖，不能清除当前 npm 安全公告；未使用 beta、next 或强制 override 冒充修复。内容安全函数审计为 1 中危／5 高危，清理函数为 1 中危／4 高危，继续阻断生产发布。

## 商家公开目录原子发布验收（2026-09-02）

- 第五批迁移 `database/mysql/0005_provider_catalog_publications.sql` 已创建 `provider_catalog_publications`；每个商家只有一行 JSON 公开快照，同时记录草稿版本和发布版本。CloudBase SDK 的 RDB 查询当前不支持事务，因此没有用多个公开表的顺序写入伪装原子事务。
- `provider-catalog-draft` 新增 `publishDraft`：只从可信微信上下文解析商家，要求精确草稿版本、正常账号与昵称、完整职业和服务、至少 3 件完整作品，并逐项确认所有图片属于本人且状态为 `READY`。
- 发布首次插入单行快照，再发布使用发布版本条件更新；冲突时返回 `PUBLISH_CONFLICT`。作品公开编号由服务端稳定生成，再发布保留编号和引用次数。
- `catalog-read` 已重新部署：新公开快照存在时一次读取该快照，避免消费者看见半套目录；尚无快照时继续兼容旧公开表。返回作品媒体资产 ID，且不读取草稿表。
- 数据库迁移、两个云函数部署和结构审计均通过。本地七组云函数契约回归为 43／43；新增覆盖发布完整性、媒体归属与状态、草稿版本、并发发布、稳定作品编号、快照优先读取和不泄露草稿。
- 开发者工具真实身份 QA 读取到草稿版本 `0`；发布版本 `1` 被 `DRAFT_NOT_FOUND` 正确拒绝，随后公开目录仍为空，整个验收没有写入业务数据。证据见 `.artifacts/cloudbase-provider-publication-runtime.json`。
- 本节初次验收时正向线上发布因空草稿延期；同日后续已由页面完成含 3 件作品和审核通过媒体的正向发布，并精确清理 QA 数据，详见下一节。

## 小程序云端目录切换与正向发布验收（2026-09-02）

- S02 商家编辑、B01 发现、B01S 搜索、B02 商家详情和 B02W 作品详情已接入 CloudBase。真实环境不再用演示商家回退；CloudBase 不可用时才保留本地审计兼容路径。
- 商家编辑页已接入草稿读取／乐观锁保存、媒体签发、`wx.cloud.uploadFile`、提交校验、微信内容安全审核状态和发布门禁；页面明确展示加载失败、待审核、拒绝、缺项与版本冲突。
- 真实正向链路创建了 1 个服务、3 件作品及审核通过媒体，保存草稿版本 1、发布公开版本 1；`catalog-read` 随后返回商家、服务、3 件作品和作品详情，开发者工具完整页面运行通过。
- 真实保存首次暴露 RDB SDK 不会自动序列化 JSON 对象。`provider_catalog_drafts.draft_json` 和 `provider_catalog_publications.payload_json` 写入已统一使用 `JSON.stringify`，重新部署后线上保存／发布成功。
- 正向视觉证据位于 `.artifacts/cloud-storefront-positive/`；空目录不回退演示数据的发现页和搜索页证据位于 `.artifacts/cloud-public-catalog-empty/`。透明 1×1 PNG 只作为媒体链路测试夹具，不代表正式作品视觉素材。
- 收尾只删除精确匹配的 QA 快照、草稿、资产和云文件；草稿／公开快照恢复为 0，QA 资产为 `DELETED`，测试存储目录为 0。该临时 QA 数据已不可恢复，未触碰用户业务数据。

## 订单核心迁移与部署验收（2026-09-02）

- 第六批迁移 `database/mysql/0006_order_aggregates.sql` 已创建 `order_aggregates`。首次执行因既有账号表使用 `utf8mb4_unicode_ci` 而外键列采用 `utf8mb4_0900_ai_ci` 被 MySQL 安全拒绝；统一为既有排序规则后重试成功，失败尝试没有创建表或写数据。
- CloudBase RDB SDK 不支持事务，订单与阶段事件以单行 JSON 聚合存储；创建为单行插入，状态迁移为带版本条件的单行更新，避免订单和事件分两次写造成半状态。
- `order-api` 已部署，提供创建、列表、详情和状态迁移。服务、初始价格、商家名称、职业和作品引用只从服务端公开快照取值；账号和角色只从微信可信上下文解析，订单同时保存双方昵称／UID 展示快照。
- 创建支持需求方范围幂等键和请求哈希；状态迁移校验参与者、角色、精确版本和合法阶段。服务端同时拒绝过去／重叠时段，并验证参考图片属于需求方、用途为 `PROJECT_REFERENCE` 且已经通过内容安全审核。
- 服务方接受预约后才可读取联系方式；结束沟通前必须记录首次获取联系方式。服务方可在公开报价 ±15% 内锁定一次新报价；补充要求、拒绝、沟通失败、双方 NDA 与需求方合作信息确认均作为带版本的订单事件持久化。
- 联系方式以 AES-256-GCM 加密保存，仅在 `CONTACTING` 及以后向参与者解密。
- `ORDER_CONTACT_ENCRYPTION_KEY` 只配置在云函数环境变量。本机脚本生成或复用 32 字节密钥，仅保存被 Git 忽略的 Windows DPAPI 密文，并删除临时明文配置目录。
- 制作阶段之前必须有服务端确认的 `PAID`。当前尚无微信支付创建单、回调验签和退款链路，因此接口按设计阻止进入制作，不接受客户端伪造支付状态。
- 订单核心单元测试 12／12 通过；连同账号、目录、草稿、媒体和回调共 8 个云函数包为 56／56。开发者工具真实账号列表为空，自购请求返回 `SELF_ORDER_NOT_ALLOWED`，过去时段返回 `INVALID_TIME_SEGMENTS`，均无写入。
- 当前只有一个微信测试身份，无法伪造第二账号冒充双参与者正向验收；真实需求方创建、服务方接单和联系方式阶段解密需第二个测试微信账号完成。

## 订单预约沟通页面云端切换验收（2026-09-02）

- B03 预约创建、B04 预约状态、B05 双身份根订单、S06 服务方订单、S04 服务方请求和 S05 服务方 NDA 已整体接入 `order-api`。正常环境不再从 `v063-store.js` 读取预约沟通订单；`audit=1` 只用于确定性视觉夹具。
- B03 从公开云目录读取服务方、服务、作品和服务端价格；创建使用页面生命周期内稳定的幂等键。上传参考图片时执行签发、云存储上传、内容安全提交与状态轮询，通过后才把资产 ID 交给订单 API。
- 双方订单列表按服务端返回的 `viewerRole` 隔离需求方／服务方记录。B04、S04、S05 的每次写操作都携带当前版本；`VERSION_CONFLICT` 会提示并刷新，不覆盖另一端已提交的状态。
- 所有新增页面补齐正在加载、加载失败、重试和请求进行中状态。业务条件不完整时仍可点击主动作查看缺项；仅请求进行中使用原生 disabled，重复点击不会重复写入。
- 微信开发者工具定向部署最终版 `order-api` 成功：4 个文件、9.5 KB。真实小程序身份复验为空列表、自购门禁和过去时间门禁通过，`writesPerformed=false`。
- 页面运行 QA 覆盖需求方／服务方空订单、服务方不存在、订单不存在、B03 完整／缺项／满客／作品引用／图片引用、B04 预约四步、S04 请求／沟通／报价／结果和双方订单三分类。22 条全路由通过，运行异常为 0。
- B03 旧满客审计夹具依赖 2026 年 8 月固定日期，当前日期下误提交一条本地 QA 订单；夹具已改为日期无关的显式冲突，并精确删除唯一匹配的 `AM-60126524`，本地计数 18→17。该 QA 记录不可恢复，其他本地记录未改。

## 购买前可以完成的步骤

1. 使用现有免费体验环境 `quest-band-d1gem4bxt3fa17720`，不要重复创建环境。
2. 将环境关联到小程序 AppID `wx57412ad07a806b70`。
3. 在微信开发者工具中打开 `wechat-miniprogram`，确认云函数目录识别为 `cloudfunctions/`。
4. 真实关联和身份探针验证完成后，再把 `miniprogram/config/cloudbase.js` 的 `enabled` 改为 `true`。
5. 部署普通事件云函数 `auth-probe`。不要给它增加 HTTP 触发器；混合调用来源会破坏 `getWXContext()` 的身份可信边界。
6. 在开发者工具控制台调用：

   ```js
   wx.cloud.callFunction({ name: "auth-probe" }).then(console.log)
   ```

   预期结果是 `result.ok === true`、`result.data.authenticated === true`，响应中不出现 `OPENID`、`UNIONID` 或腾讯云密钥。

## 密钥与数据边界

- CloudBase 环境 ID 不是密钥，可以写入小程序配置。
- 腾讯云 SecretId、SecretKey、CloudBase API Key、微信 AppSecret 不得写入小程序、Git 或测试截图。
- 普通事件云函数使用运行环境提供的临时身份，不在代码中配置固定云密钥。
- `auth-probe` 只验证身份链，不写数据库，不创建账号，不改变订单。
- `auth-probe` 和开发环境内容安全 OpenAPI 适配当前锁定 `wx-server-sdk 4.0.2`。截至 2026-09-02，`npm audit` 对其传递依赖报告 1 个中危、5 个高危问题；前者不读取事件参数、不发起外部请求且不访问数据库，后者只接收服务端已校验的本人资产 ID，并使用固定的 `security.mediaCheckAsync` API。两者都只允许用于开发环境连通性与全链路验证；生产发布前必须升级到平台确认的安全运行时／SDK 版本并重新审计。
- `account-bootstrap`、`catalog-read`、`provider-catalog-draft` 和 `media-upload` 使用当前官方 `@cloudbase/node-sdk 3.18.3`。该版本的固定传递依赖仍被 `npm audit` 报告 1 个中危、4 个高危项；函数不接受 URL、表名、列名或 SQL 输入，所有数据库查询均为固定结构，但在正式生产发布前仍需跟进官方安全版本并重新审计。
- 订单聚合迁移、创建幂等、状态版本和事件原子可见性已完成；正式接入前仍必须完成支付回调、真实双账号运行验收、日志监控和备份恢复验证。

## 尚未完成

- **P1｜首次使用账号体验缺口**：C 端没有首次使用引导、协议确认、资料完善分流，以及账号初始化失败时的可见重试状态。微信官方登录能力允许服务端用 OpenID 建立小程序用户体系，当前 CloudBase 静默创建／复用账号的方向成立；头像昵称应通过用户主动选择和填写完善。因此后续采用“静默身份 + 首次引导／资料完善”，不重复建立用户名密码注册体系。
- **P1｜支付后订单页面切换**：预约沟通阶段已经整体接入 `order-api`；支付成功后的订单详情、制作进度、交付、验收和历史订单仍需补齐云端字段／文件能力并切换，不能在支付闭环前伪造可达状态。
- **P1｜真实双账号订单 QA**：当前只有一个微信测试身份，自购门禁已通过且没有写入；仍需第二个微信测试账号验证创建、接单、补充、联系信息解密、并发版本冲突和双方列表隔离。
- **P1｜支付闭环**：缺少微信支付商户配置、服务端下单、回调验签、幂等入账、退款和对账；在服务端确认 `PAID` 前，订单接口保持制作阶段门禁。
- **P1｜生产安全阻断**：`@cloudbase/node-sdk` 与 `wx-server-sdk` 的传递依赖安全公告仍未由官方稳定版本消除；生产部署前必须升级并重新审计。
- **P2｜其余业务域**：评价、资金流水／结算、档期和项目等 SQLite／D1 结构仍需转换为 CloudBase MySQL 迁移与可信身份 API。
- **P2｜账号资料**：新增账号当前仍为默认昵称“微信用户”；需用户主动授权／填写头像昵称、职业和协议状态，服务端提供资料更新接口。
- **P2｜运维**：补齐结构化日志、错误告警、备份恢复演练、预发布／生产隔离、限流和成本监控。
- **P2｜终端验收**：目录与预约沟通链路已通过开发者工具全页 QA；仍需真机双账号、弱网、长文本、重复点击、系统返回和支付后页面压力测试。

### 本机阻塞处理结果（2026-09-01）

微信开发者工具 2.02.2608040 手动启动后恢复正常，实际 IDE 服务端口为 `18254`，自动化端口为 `9422`。无需重装；已完成登录检查、项目打开、RPC 预检、核心路由、云函数身份调用和真机身份验证。

## 官方依据

- [CloudBase 快速开始](https://cloud.tencent.com/document/product/876/121103)
- [CloudBase 套餐及资源包](https://cloud.tencent.com/document/product/876/136006)
- [小程序调用 CloudBase 云函数](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)
- [微信小程序登录](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)
- [微信头像昵称填写能力](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/userProfile.html)
- [微信小程序网络使用说明](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)
- [微信 mediaCheckAsync](https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_mediacheckasync.html)
- [微信云调用与 OpenAPI 权限](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/guide/openapi/openapi)
- [小程序消息推送配置](https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push)
- [CloudBase setCallBackConfig](https://developers.weixin.qq.com/doc/oplatform/openApi/cloudbase-common/msg-push/api_setcallbackconfig.html)
- [CloudBase 数据库原始查询限制](https://docs.cloudbase.net/en/model/db-raw-query)
- [CloudBase MySQL 原生连接与事务说明](https://docs.cloudbase.net/en/database/configuration/db/tdsql/faq)
