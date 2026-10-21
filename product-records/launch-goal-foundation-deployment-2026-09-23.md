# 正式上线持续目标与基础函数部署（2026-09-23）

## 目标及最新用户信息

用户明确要求持续工作直到小程序正式部署上线。已建立活动目标，不再以小批本地回归作为目标完成条件。必要开发、上线准备及已有公司环境的可回退代码更新继续推进；未获得付费、接受无 TLS 数据库链路或确定新商业规则的授权。

用户本轮确认：备案及经营资质尚未获批，正在修改材料；已注册商户号，但不知道是否开通多服务方收款分账。目标保持需求方微信支付、验收后由微信支付按约定分配平台与服务方费用，不替换为平台自行转账。商户产品与资金路径仍须核验。云服务月基础预算问题已提出，尚未回答。

## 当前实时云证据

公司专用 CLI 只读查询成功：环境 cloudbase-d2g65rqbvee0bd978，上海，Normal，个人版；环境列表显示到期时间 2027-03-23 23:59:59。此字段不是免费保证或正式发布后的价格承诺。

云端目前仅 auth-probe、account-bootstrap、account-api、catalog-read 四个函数；后端整体未部署齐全。

## 本轮实际部署

先完整下载三函数旧代码到忽略目录 wechat-miniprogram/.artifacts/release-foundation-backup/<函数名>，核验入口存在及 SHA256，然后通过 fn code update 更新代码。未通过配置更新命令修改环境变量；没有新增函数、网关、触发器、套餐或数据库表。

CLI 返回三个代码更新成功，fn list 二次查询显示 Deployment completed，修改时间：

- account-bootstrap：2026-09-23 16:41:38
- account-api：2026-09-23 16:42:21
- catalog-read：2026-09-23 16:42:25

部署前 270 项本地回归通过。部署后开发工具公司 AppID 守卫下四项只读验收通过：getSession registered=false；getMine ACCOUNT_NOT_FOUND；listProviders 空；listDiscovery 空、total=0、nextCursor=null。没有创建账号或业务测试数据。

首次合并四请求的验收失败，仅输出通用 Error；未定位其根因。验收脚本现将每个函数查询拆成单独自动化调用，记录失败阶段并保留只读与 AppID／环境守卫；改后四项通过，不据此宣称根因已解决。

## 接续执行优先级

1. 正式／体验版本预览隔离：local-preview.isAudit 当前仍直接接受 audit=1；auth 页面另有直接入口。云端开关仍 false，先修上线隔离与准备真实验收版本，不悄悄改变已审视觉。
2. 依赖完整性审查后部署非支付业务；真实写入用可识别隔离测试资料，不把只读验证当完整验收。
3. 数据库事务路线及预算决策。当前无 TLS 与严格连接实现不兼容，不能默认购买标准版或降低校验。
4. 微信平台收款／分账产品、服务方进件、资金规则与真实交易验收；不只凭商户号声称支付已接通。
5. 备案、资质由用户继续处理；全链、隐私、真机和发布条件满足后再执行提审发布。活动目标未完成。

本会话未找到可调用的浏览器控制工具，未读取用户后台登录态或页面；不将环境附带 URL 当作后台已验收证据。优先使用现有公司 CLI，若后续工具恢复再核查后台。

## 正式版演示入口隔离补充

- 正式版传入 `audit=1` 曾可进入演示数据；已将共享 `local-preview.isAudit` 限定为本地预览环境，登录页独立入口也使用相同门禁。
- 开发／体验版现有审稿行为保留，未开启客户端云连接，未上传客户端；后续真实体验版联调仍须配置明确的运行模式。
- 6 项本地回归通过，覆盖正式版伪造登录／注册／成功／加载参数与地区隔离；设计目录重新生成，design:check 通过。尚无本次正式包真机证据，不能标记 A07 全部验收完成。

## 2026-09-23 联网版本与演示模式隔离

A07 继续推进：local-preview 统一以 cloudbase.enabled 为联网边界；开启云连接后，开发工具／体验版／正式版全部禁止演示数据和 audit 参数免登录，当前 enabled=false 保持审稿预览。未增加用户开关或修改视觉布局。影响查询覆盖 26 路由。

验证：16 项预览、地区及手机号流程回归通过；覆盖联网开发工具携带 audit=1/state=success 仍请求真实会话且不显示假成功；本地预览阻止云请求审计、design:check 通过。修复旧测试对已开启云配置的隐含依赖，联网场景只在隔离测试上下文注入配置，真实项目未启用。尚无联网体验包、完整页面和双账号真机证据，A07 不关闭。下一步继续核对剩余函数部署依赖及发布配置。

## 2026-09-23 第二批基础业务实际部署

在持续推进正式上线的授权下，先核对当前函数清单与配置，23 项项目／收藏／档期本地回归通过，随后首次部署以下 Event 函数（Nodejs20.19，timeout 15 秒，云端安装依赖）：
- project-api：16:55:58，云端 Deployment completed。
- saved-items-api：16:57:00，云端 Deployment completed。
- availability-api：16:57:36，云端 Deployment completed。

无新 HTTP 入口、定时触发器、套餐购买、数据库迁移及业务数据写入。客户端 enabled=false 保持；支付、订单、媒体、目录草稿等其余函数尚未部署。

扩展 automation/company-foundation-runtime-audit.js --business：七项公司 AppID／环境下的真实只读检查通过。getSession 未注册，目录为空；account-api/getMine、project-api/listProjects、saved-items-api/listMine、availability-api/getMine 均 ACCOUNT_NOT_FOUND。仅证明函数运行与未注册门禁，不证明已注册写入、双方权限、占档事务或完整业务验收。

首次整组在 account-bootstrap:getSession 失败；单独调用确认 registered=false 后，整组重验七项通过。未取得首次失败根因，稳定性仍待观察，禁止以重试通过宣称故障已修复。无需重复部署这三项。下一步优先核查真实表／文件权限与其余函数部署前置，等待云预算及数据库安全路线决定期间继续可独立工作。

## 2026-09-23 橱窗与人工接单审核入口实际部署

provider-catalog-draft 已首次部署到公司环境（Nodejs20.19／15 秒／Event，无 HTTP 入口或定时器）。部署前草稿与发布共 15 项回归通过，覆盖可信身份、版本冲突、媒体归属与用途、当前职业审核通过门禁及禁止客户端自批资格。

扩展 company-foundation-runtime-audit.js --business 后，九项实际云端只读验收整组通过：新增 getDraft、getQualification 均对当前未注册微信身份返回 ACCOUNT_NOT_FOUND；原七项继续通过。未创建业务数据、未执行审核决定、未开启客户端云连接；通过不等于真实服务方草稿保存、审核操作、上传或公开发布已验收。

当前已部署八个函数：auth-probe、account-bootstrap、account-api、catalog-read、project-api、saved-items-api、availability-api、provider-catalog-draft。媒体上传／审核／回调／清理、订单、支付仍未部署。媒体审核具备 security.mediaCheckAsync 本地权限声明，但实际微信权限与回调尚未配套，不能提前开启真实上传。下一阶段继续检查媒体及回调成套接入与缺失配置，真实双账号联调仍待完成。

## 2026-09-23 媒体服务部署与旧环境配置保护

media-upload 已部署到公司环境；部署前上传、审核核心／适配器及回调核心 39 项回归通过。company-foundation-runtime-audit.js --business 扩至十项，实际云端全通过；getOwnedMedia 对未注册身份返回 ACCOUNT_NOT_FOUND，无文件上传、业务数据写入或审核调用。现已部署九函数，未部署审核提交／回调／清理、订单、支付；客户端 enabled=false。

回调前置核对：公司本地独立配置仅含 envId、ACCOUNT_PHONE_HASH_KEY、ORDER_CONTACT_ENCRYPTION_KEY，未输出密钥值；WX_CALLBACK_TOKEN／WX_CALLBACK_AES_KEY 尚未准备，微信后台消息推送 URL／加密方式／握手亦未验收。真实上传需这些配套与实际内容安全权限，不把上传函数部署当审核链路完成。

A04：两份历史可变更密钥脚本 configure-account-phone-key.ps1、configure-order-contact-key.ps1 原先硬编码旧环境。现先比较项目 cloudbaserc.envId 与旧目标，不一致立即停止，早于任何密钥读取、生成、文件写入和网络调用。当前公司项目实跑均按预期拒绝；没有轮换公司或旧号密钥。历史 verify-account-phone-key.ps1 仍是旧号只读验证入口，不能用于公司验收。旧环境数据保留。

后续继续成套准备回调及媒体审核，不能跳过真实身份／媒体／双账号验收。数据库路线、云预算、商户产品及资质仍待外部决策或确认。

## 2026-09-23 加密验签回调已部署，云调用握手实测通过

通过浏览器实际读到官方 message-push 页面，其正文是公众号环境共享／客服消息推送，不足以证明小程序图片审核事件可免鉴权接入。保留现有加密 HTTP 验签实现，没有添加 event 字段旁路。

新增 scripts/prepare-company-callback.js：校验公司 AppID/env，创建并重复使用独立 WX_CALLBACK_TOKEN／WX_CALLBACK_AES_KEY，密钥及单函数部署配置仅在 Git 忽略的 .cloudbase-cli-config/company-callback-secrets.json、company-callback-deploy.json。没有输出秘密值、没有复用旧号密钥。首次部署发现 CLI 对绝对 Windows functionRoot 重复拼接，改为项目相对目录后成功部署 wechat-message-callback（Event／5 秒／Nodejs20.19）。

新增 automation/company-callback-runtime-audit.js，从当前公司开发工具实际调用已部署函数：真实签名 GET 返回 200+指定 echostr，伪签名返回 403。验收不带数据库写入，不打印签名或密钥。此证据证明函数与 Token 部署匹配及云调用入口验签，不等于公网路由、微信消息推送握手或实际加密审核事件通过。

当前已部署十函数；还未部署 media-security-submit、media-pending-cleanup、order-api、payment-api。尚未创建回调公网路由、未在微信后台输入或启用推送配置、未上传媒体、未启用客户端云连接。下一步读取实际域名与路由配置，准备唯一回调入口及其公网验签检查，再完成微信端配套配置。浏览器凭据配置若触及技能要求手动接管，应先准备完整可用接收地址，再请用户完成录入；不要让用户发密钥到聊天。

## 2026-09-23 回调真实域名核对及公网入口待批准

公司 CLI routes list 返回空数组（total=0）；domains ls 返回唯一默认域名 cloudbase-d2g65rqbvee0bd978-1494174688.ap-shanghai.app.tcloudbase.com，HTTPSERVICE／DIRECT／HTTP_AND_HTTPS／SUCCESS／DNS OK。旧脚本假定的 env.service.tcloudbase.com 未经此环境验证，已将公网验收目标校验改为实际域名；callback-target 测试通过。

拟创建路径 /wechat-message-callback，仅转发 SCF wechat-message-callback；enable=true，enableAuth=false（由函数验证微信签名），enableSafeDomain=true，不添加其他路由、不改变数据库权限。自动审批拒绝执行：持久公网路由且关闭平台登录鉴权，需要用户明确批准具体访问范围。动作未执行，不得换命令或浏览器绕过。已通过 async 请求批准唯一回调入口，说明公网请求会占用调用配额；等待答复，不将沉默视为批准。

独立推进：公网验收脚本补齐正确／伪造 GET 握手、正确加密／伪造 POST，每次15秒超时、禁止重定向、不打印原始签名或秘密。语法及目标测试通过，尚未运行公网验收。批准后先核对用户决定，再创建路由／只读重查并运行四项真实 HTTP 检查；微信后台 Token/AES 录入及启用尚未进行。

十函数部署、27表ADMINONLY／存储PRIVATE、客户端enabled=false保持。真正上线仍有资质、数据库路线预算、支付产品与业务规则、真实双账号及资金／媒体验收等未完成，目标保持 active。

## 2026-09-23 图片审核提交函数已部署及十一项云端只读验收

持续上线目标授权下，先查询确认公司环境尚无media-security-submit，然后单独fn deploy media-security-submit --install-dependency true；无--all/--path/--httpFn，不创建路由、定时器或业务资料。云端二次清单确认Nodejs20.19、Deployment completed，创建／修改时间2026-09-23 19:03:48。现共11个函数，待部署剩order-api、payment-api、media-pending-cleanup。

company-foundation-runtime-audit.js --business新增getImageStatus，使用合法格式的不存在资产ID，仅走只读身份／状态接口。整组第二次11项通过：登录未注册、公开目录空，新增审核状态读取返回ACCOUNT_NOT_FOUND。未调用submitImage、上传、注册、支付；不证明微信内容安全权限或回调闭环。客户端enabled=false，回调公网路由仍按原批准待决，不绕过自动审批。

第一次仍在account-bootstrap:getSession失败，不能以第二次全通过关闭稳定性问题。验收脚本增加脱敏失败分类、耗时、数值errCode，不打印原始响应；本次失败发生于该诊断加入前，未获得失败原因。进一步两次只读fn log --error查询均失败，结构化CLI错误关键词为ResourceNotFound／Topic／Cls，表明当前查询未取得CLS日志主题，不推断函数一定无日志，也未创建付费日志资源。需补足日志可观测性并定位首次调用失败，作为真实登录上线验收门槛。

## 2026-09-23 开发工具10秒等待限制已实证，十二项云端只读验收通过

A05/E03：在相同开发工具连接执行完全不调用云端的受控11秒等待。直接App.callFunction等待结果在10003ms返回TIMEOUT；同一11秒任务以短请求轮询读取在11080ms正常完成，cloudCalls=0，实验退出0。结合前轮错误来自自动化外层且无小程序catch结果，确认这类约10秒观察失败可以由开发工具等待限制造成，不应直接归咎于登录服务。不能据此追溯断言所有历史通用Error均为同一原因。

company-foundation-runtime-audit改为一次发起、观察同一getApp临时任务：函数内部仍捕获脱敏错误；轮询观察失败继续读同一任务，不重发云调用；已完成结果读取确认后清理；120秒观察上限保留jobKey并报未完成，不把未知结果算成功。临时任务不写持久化存储，无业务变更。3项自动化诊断测试通过，含桥接不等待云Promise、观察失败仅一次云调用、SDK错误脱敏、错AppID阻断和完成清理。

新方式真实整组12项通过，包括更新后的project-api/getTargetImages对未注册身份返回ACCOUNT_NOT_FOUND（940ms）。getSession registered=false（6557ms），所有既有空目录／账号门禁继续通过。此次补齐项目新接口的真实部署启动和未注册门禁证据；仍不是已注册项目签图、跨账号权限、实际TTL、微信图片审核或资金验收。客户端enabled=false，未创建业务数据。

后续不再把当前已实证的自动化10秒等待限制记为未定位登录故障；真实登录稳定性／冷启动性能与完整账号验收继续保留。CLS无主题的可观测性缺口独立保留，不因此购买日志资源。

## 2026-09-23 微信云调用权限声明补齐与官方工具上传

A05/A06/D01：发现account-bootstrap使用cloud.openapi.phonenumber.getPhoneNumber但缺config.json。新增最小permissions.openapi=[phonenumber.getPhoneNumber]；media-security-submit已有且仅声明security.mediaCheckAsync。官方CloudBase说明要求config声明并通过微信开发者工具上传生效，可能有约10分钟权限缓存：https://docs.cloudbase.net/faq/knowledge/cloud-call-604101-permission-error （本轮已读取）。未把CloudBase CLI源码搜索未命中当成实际权限缺失证明。

先下载两函数当前代码至.artifacts/openapi-backup-20260923/并核对入口hash；37项身份、手机号、媒体核心与适配器测试通过。随后官方开发工具CLI cloud functions deploy明确公司env/AppID对应项目、仅account-bootstrap与media-security-submit、远端安装依赖，报告两者success=true。后查公司CLI详情：两者Active、Nodejs20.19、15秒；更新时间分别19:41:59／19:42:18，登录函数ACCOUNT_PHONE_HASH_KEY仍存在（只输出布尔值）。未读取或输出密钥值、未改网关／定时器／客户端开关、未调用收费手机号接口或提交审核。

纠正诊断记录：最初筛选原始详情中的timeout关键词将Timeout配置字段误判为查询超时；明确端口18255查询与精确错误检测后确认info成功、ExplicitTimeoutError=False，不能把该关键词当故障证据。官方list也已实际返回11函数。Exa检索受网络限制未成功，已用可用网页工具读取上述官方主源，不依赖第三方转载。

权限声明完成官方上传，不等于实际微信接口权限或手机号／图片链路通过；仍需真实授权code、媒体提交及回调验收，不能以只读ACCOUNT_NOT_FOUND判断已调用到OpenAPI。回调路由批准、手机接管及其他上线门槛保留。

部署后补充证据：company-foundation-runtime-audit.js --business整组12项真实只读检查通过；登录未注册、公开目录空，手机号／审核函数身份门禁及项目图片入口保持预期。实际微信OpenAPI调用仍未进行。


## 2026-09-23 微信回调公网入口已创建并实测

A05/D01：用户明确批准新公司环境唯一公网路径 /wechat-message-callback，仅连接同名函数、不要求平台登录但校验微信签名。先备份旧函数至 wechat-miniprogram/.artifacts/callback-error-backup-20260923，再修复 ERROR 结果终态与重复通知补偿：重复 ERROR 可补齐中断的资产拒绝状态，但不重写裁决证据，后续冲突 PASS 不覆盖；非零或错误类型 errcode 不能因 suggest=pass 放行。20 项回调测试通过，函数代码已部署。

新 routes 接口拒绝对 app.tcloudbase.com 系统内部域名手工建路由，未创建资源；不是授权拒绝。随后官方 DescribeCloudBaseGWService 实际返回已开启网关及默认域名 cloudbase-d2g65rqbvee0bd978.service.tcloudbase.com。通过官方 CreateCloudBaseGWAPI 创建单一路径，APIId=b2217639-60ca-4549-9b79-b8e6cfdb5cdb；只读回查 Total=1、函数 wechat-message-callback、EnableAuth=false、无冲突。该接口返回 Domain=*（环境网关域名范围），路径仍严格为 /wechat-message-callback，没有创建其他路径或购买域名。

可用地址：https://cloudbase-d2g65rqbvee0bd978.service.tcloudbase.com/wechat-message-callback
验收脚本目标白名单按实际网关查询更新，目标守卫测试通过。公网四项实际检查通过：合法 GET 握手 200 且原样返回 echostr、伪造 GET 403、合法加密测试 POST 200/success、伪造 POST 403/forbidden。测试事件为 anime_master_callback_audit，不是审核业务事件，不写账号、媒体或订单数据；密钥从本地受忽略文件读取，不输出、不上 Git。

剩余：微信后台 URL/Token/AES 安全模式配置与平台保存校验、真实媒体提交及审核回调落库、双账号与私有文件证据。公网测试通过不等于微信已配置或实际审核已完成。客户端继续 enabled=false。控制台标签页读取连续超时，未因此操作备案或商户页面。


### 回调安全模式补强与最终复验

进一步复审发现旧 POST 兼容明文消息，而普通握手签名不覆盖正文。按既定安全模式关闭明文 POST，GET 握手保持不变；新增带合法握手签名的明文 POST 拒绝回归，先复现旧实现返回 200，再修复为 403。函数再次代码更新成功；全部回调及目标守卫测试 22 项通过。最终公网五项实测通过：GET=200、合法握手签名明文 POST=403、伪造 GET=403、加密 POST=200、伪造加密 POST=403。测试仍不写业务数据。

已向用户提出微信后台接管任务：填写已验证 URL，安全模式、JSON；Token/AES 从本地 .cloudbase-cli-config/company-callback-secrets.json 读取并自行填写，不在聊天传递。尚未收到保存结果，不视为后台已配置。此为 Browser 技能认证凭据接管要求，非要求重新批准公网路径。


### 回调开发工具观察脚本修复

company-callback-runtime-audit 已改为每项签名检查只启动一次，通过短读取观察同一内存任务；观察超时不重发云调用，完成后清理，120 秒未完成保留任务标识供后续核查。错误输出不含 SDK 原文或签名。3 项回归覆盖观察中断不重发、错 AppID 零调用、云错误脱敏与清理；真实公司开发工具再次通过正常握手及伪造握手拒绝两项检查。未改客户端云开关或业务数据。后台配置接管问题仍待用户回复。


## 2026-09-23 用户完成微信后台消息推送配置

用户明确反馈“配置完成。继续工作吧”，消息推送后台填写由待用户接管改为用户确认完成；本轮未独立查看后台表单或微信来源审核事件，因此真实图片审核闭环仍待验。再次执行公司开发工具 12 项只读检查全部通过，当前微信身份 registered=false，媒体等接口仍按预期返回 ACCOUNT_NOT_FOUND。

下一阶段真实媒体验收需要先由用户完成注册告知确认和昵称注册，再进行本人私有图片上传、审核提交、微信真实回调及状态读取；不能通过脚本代替用户同意注册告知。客户端仍 enabled=false，尚未开启全量云流程、创建账号或媒体测试数据。

独立推进 D01：复现 ERROR 裁决已持有 trace_id、资产写入尚未完成时 submitImage 错误清空流水号并重新请求的问题；以及读取后其他请求已写流水号而旧重试仍领取的竞态。修复为有流水号的 ERROR 不重新提交；ERROR 重试更新增加 trace_id IS NULL 原子条件。保留无流水号的明确失败重试及十并发单次提交。新增两项先失败后通过回归，与审核适配器、回调共 42 项测试通过；未修改 UI、审核商业规则或文件公开权限。云端旧代码备份 .artifacts/media-trace-backup-20260923；正在通过官方开发工具更新 media-security-submit，部署结果另记。


部署补证：官方开发工具 cloud functions deploy 对 media-security-submit 返回 success=true、8 文件、20.7 KB。部署后公司开发工具整组 12 项只读检查全部通过，审核状态接口仍正确返回未注册身份门禁。本地两文件 diff --check 无错误。真实媒体提交、回调写库与两个真实账号仍未验；不以只读门禁替代上述证据。
