> 2026-09-26 最新决定（用户明确回复“对”）：接受公司微信收全款、系统计算平台20%/服务方80%税前收入、财务通过企业网银批量向服务方付款及回单核销。此决定取代先前否决公司先收全款的决定；不再将服务方子商户直接收款作为本阶段前置。手续费由平台承担。银行、模板、结算日期/频次、税务及已付款后退款仍待明确；已询问开户银行。允许按bank-batch-settlement-draft-2026-09-26.md方向改造，但不等于授权真实付款、数据库扩权或确认资质合规。公司直收硬性拒绝将撤回，真实付款开关仍保持关闭。

> 2026-09-26 最新用户决定：明确否决“公司先收全款再向服务方付款”的资金模式，停止DIRECT公司代收后商家转账/平台余额提现路线；此前优先公司真实直收的实施授权不再作为继续该路线的依据。保留历史代码及证据，不删除数据、不启用真实付款或转账、不把旧DIRECT部署当最终上线能力。目标改为服务方渠道商户直接收款、平台取得20%、服务方80%税前收入，通道手续费由平台承担。平台收付通仅为待准入核实候选，尚未获批或确认适用万匠屋服务范围；原公司商户分账20%不等于二级商户收款能力。核实与迁移边界见 payment-routing-decision-2026-09-26.md（检查点引用路径为product-records/）。

> 2026-09-26 用户已确认：支付、退款及提现等通道手续费始终从平台扣点中支出，由平台承担，不额外扣减服务方80%的税前应结收入。实际渠道费率、费用凭证仍按渠道事实记录；税务扣缴另行确认。本决定覆盖下文历史的手续费承担待定描述。用户截图显示商家转账仍为“申请开通”，尚未获批，不能启用真实提现。

# 公司主体收款改造与当前交付

用户最新授权：按既有支付、收益、提现方案实施，遵守现有设计规范；本阶段先完成小程序公司主体真实收款；资质、类目及渠道资格风险先登记待办，不再阻塞本阶段代码改造。真实支付及正式上线目标尚未完成。

## 已实施并部署

- 支付主服务及查询转发、资金操作转发、防重服务均完成更新，仍为关闭态。公司直收使用普通商户 JSAPI 下单；不再要求服务方存在子商户，不传普通分账标志，不把商户20%分账上限解释为平台抽成。
- 0036迁移已在公司库执行并回查：付款记录保存 DIRECT/COMBINE 模式；历史记录默认COMBINE；DIRECT的sub_mchid为NULL，CHECK约束禁止两种身份混用。回查订单/付款/结算均为0。
- 下单沿用服务端订单金额、身份、协议快照、幂等请求和租约；查单/关单按该付款单保存的模式，不因随后全局配置变化而切错渠道。
- 直收回调仍校验微信原始签名、AES-GCM报文、商户/AppID/付款人/金额/订单号，重复回调只入账一次。修复部署JSON中的API v3密钥未转Buffer的问题。
- 公司收款不能进入旧电商子商户分账流程；验收不会因此变成可提现或出款成功。
- order-api以官方“仅更新代码”命令部署收益明细：从付款单保存的服务费快照计算预计收益；待核对付款不提供预计收益；未开放的可提现余额仍为null。
- 资金页本地前端新增订单总额、平台服务费、预计收益、提现指南；复用既有资金页和服务方订单详情入口，无新钱包充值入口。风格沿用深色/桃橙主题、共用金额样式及token。客户端尚未上传新手机预览或发布。

## 验证证据

- 支付/收益接口及资金页单元测试119项通过；订单服务76项通过；付款页/查询页及结构前检26项通过。
- 本机MySQL 8.4完整支付集成测试103项通过，包括无服务方商户的直收预留及签名预支付会话复用、并发重复回调、错付款人/商户/AppID拒绝、直收阻止旧渠道分账。
- 修复测试迁移读取器对SQL注释中的分号误拆分，未修改历史注册迁移。
- design:check通过，27页21模块登记完整，无新增局部样式债务，未刷新baseline。
- 公司库结构回查通过；支付主服务配置回查通过；三个转发/防重服务配置和实际关闭态拒绝调用通过。
- 本地测试输出：`.artifacts/payment-mysql/direct-unit-result.txt`、`direct-integration-result.txt`、`order-unit-result.txt`（仓库根目录）。部署检查：`wechat-miniprogram/.artifacts/payment-relay-package-audit.json`及相邻relay审计记录。
- 当前资金页空态、两种收益记录及原生提现指南整屏：`wechat-miniprogram/.artifacts/company-direct-payment-runtime/{empty,records,guide}.png`，同目录runtime.json记录通过。明确是UI测试夹具，非云端真实支付记录。
- 开发工具SDK实际为3.17.0，Tool.getInfo漏报SDKVersion，因此使用实际wx运行信息校验。热更新后的旧模拟器出现空白/导航调用不回应，冻结前端副本company-direct-ui-final在9425完整复验通过；没有修改产品导航规避问题。注入后显式同步Page.setData，避免工具视图不同步误报空态。
- 实屏发现原生button默认宽度覆盖记录行：由184px且左边距72px修复为328px且左边距0；仅资金页记录行加限定选择器，消除订单号/金额不必要换行。当前整屏已检查；真实账号、真机及完整付款流程仍待验。
- order-api纯代码更新后，订单服务/占档服务配置布尔回查全部通过，线上原密钥、通知关闭态及网络均保留。

## 正式商户材料与真实收款剩余步骤

用户已确认商户号为1750932981，商户API证书、API v3密钥和微信支付公钥均未设置。此前文件名检查未找到材料，不再要求用户寻找已有证书；按首次配置处理。

本机已用scripts/payment-api-v3-key.ps1为1750932981生成32位随机大小写字母/数字API v3密钥，以当前Windows用户DPAPI加密保存在Git忽略的私有配置目录，Initialize和Status通过。未打印明文、未复制到剪贴板、未设置到微信后台，也未放入云端运行配置。Copy动作仅在用户准备粘贴时使用，不能重新生成或覆盖现有密钥。

独立payment-notify函数及/wechat-payment-notify公网路由已部署。入口为https://cloudbase-d2g65rqbvee0bd978-1494174688.ap-shanghai.app.tcloudbase.com/wechat-payment-notify 。关闭态配置、私网数据库及出站关闭保持。实际POST定位到网关附带multiValueHeaders，原适配器一律拒绝；修复为仅接受与headers完全一致的单值映射，拒绝重复/冲突/未知值，不改动签名和解密规则。HTTP适配器与函数入口20项测试通过；正式微信签名通知仍需证书材料后验收。响应只返回白名单错误码以支持脱敏诊断。

Chrome现有连接两次读取标签页失败。官方诊断确认Profile 1扩展已安装且启用；沙箱读取HKCU初报不存在，提升权限仅做只读复核后确认真实用户注册表、manifest和origin全部正确。未要求重装、未修改插件，也未冒称已读取API安全页。已请用户在API安全页仅提供三项配置状态，不发送密钥。

1. 商户平台“账户中心→商户信息”核对公司主体及商户号；“产品中心→AppID账号管理”核对绑定小程序wxc94e1c1b38944511。
2. “账户中心→账户设置→API安全”核对商户API证书、公钥管理、API v3密钥状态。私钥/密钥不发聊天；材料保存到本地受控目录后再配置。已有API v3密钥不能从平台重新读出，不能擅自重置影响其他系统。
3. 回调函数及公网路由已建立；继续验证原始报文传递与真实微信签名，检查防重表最小INSERT授权。无签名请求拒绝不等于真实支付验收。
4. 正式材料齐全后配置公司直收和relay，仅开启所需收款/查单能力；用真实双方账号、真实订单在真机由用户完成付款，回查微信交易号与公司商户到账记录。
5. 再验回调重复、取消/超时查单、退款、对账、异常处理。未发生真实付款，不得标记支付目标完成。

官方依据：[普通商户小程序下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791897)、[开发必要参数及后台位置](https://pay.wechatpay.cn/doc/v3/merchant/4013070756)、[微信支付官方SDK查单与关单接口](https://github.com/wechatpay-apiv3/wechatpay-go/blob/main/docs/payments/jsapi/JsapiApi.md)。

## 后续改造与暂缓风险（不能遗漏）

- [ ] 完整收益账本/退款冲正/资金冻结与可提现计算；本轮只有不可变付款与费用快照及预计收益展示。
- [ ] 收款资料输入、加密实名/银行卡存储与审核；待实际出款渠道所需字段确定后实施，当前不收集无用途的证件信息。
- [ ] 提现申请、资金来源分配、实际出款、回调/主动查单、失败回退及到账凭证；当前指南明确未开放。
- [ ] 后台对账/退款/异常处理权限与操作记录、账务报表；现有只读健康审计继续保留。
- [ ] 用户暂缓：工具完整二级类目与实际交易范围、平台资质及渠道准入、个人服务者经营身份、税务扣缴/报送、微信履约订单管理、虚拟支付边界、规则公示。保留风险审查原文，恢复评估时间为扩大真实运营/正式提审前，不作为当前开发阻断。
- [ ] 双账号真机验收、当前整屏与返回/身份验证、手机预览、正式提审及发布。

自动审批记录：拒绝读取线上order-api环境变量后落盘，理由为扩大凭据暴露范围。未重试或绕过该复制操作；改用官方fn code update，更新代码成功且不复制线上密钥。
本轮回调兼容修复已成功部署，公网POST复验返回503 PAYMENT_VERIFIER_NOT_CONFIGURED，表明已通过网关格式检查并到达验签配置门禁；当前缺正式公钥和APIv3配置，未进行真实付款。

## 2026-09-25 正式商户证书已收到并校验

用户提供目录D:\密钥\cert，现有文件1750932981_20260925_cert.zip，包含apiclient_cert.pem、apiclient_key.pem、apiclient_cert.p12及说明文件。只在内存读取证书和私钥，未解压/复制私钥到仓库，未输出私钥。

scripts/inspect-payment-certificate.ps1实际验证通过：证书主体商户号1750932981；2048位RSA；私钥匹配；当前有效，到期2031-09-23T16:58:56Z（北京时间2031年9月24日）。序列号35A10D040E9F698AB5FC9B35CFEFDC89C5E710B9。仅证明本地证书结构、归属、日期和配对，尚未证明微信后台启用状态/签发信任或商户AppID绑定。

新增校验测试6项通过：有效证书、错商户、错私钥、过期、尚未生效、损坏证书；测试用自签证书，不作为正式材料，临时私钥ZIP已清除。

用户明确授权“允许复制到剪贴板”后，现有APIv3密钥已复制成功（copiedToClipboard=true）；未重新生成、未输出密钥。微信后台是否设置成功待用户反馈。先前自动审批曾因未明确授权剪贴板秘密复制而拒绝；未绕过，取得此次明确授权后才执行。

下一步：用户完成APIv3设置，申请/下载微信支付公钥及提供公钥ID；核验AppID关联，安全准备正式配置、relay公钥和回调配置。支付开关仍关闭，尚未执行真实付款。
用户最新回复已设置，APIv3后台设置记为用户确认完成；尚未取得真实通知解密证据。即时检查D:\密钥\cert仅有证书ZIP，下一依赖为微信支付公钥及其ID，随后核验AppID关联并安全注入正式配置。
用户提供微信支付公钥ID：PUB_KEY_ID_0117509329812026092500181593000200。当前D:\密钥\cert只有商户证书ZIP；D:\密钥与用户Downloads中的相关文件名检查尚未发现微信支付公钥文件。公钥ID已记录，但不能替代公钥内容。支付主服务与payment-notify实时配置审计各11项全部通过，已明确检查DIRECT模式；支付仍关闭，正式公钥待下载。

## 2026-09-25 微信真实接口只读联通及正式材料接入

用户已下载D:\密钥\cert\pub_key.pem（451字节），公钥ID为PUB_KEY_ID_0117509329812026092500181593000200；已确认APIv3设置与AppID wxc94e1c1b38944511关联成功。公钥为2048位RSA。

新增probe-company-wechat-payment.ps1/.js：内存读取证书ZIP，私钥只通过子进程标准输入传递，不落盘或输出；调用固定微信官方主机的GET查单，随机不存在订单，不创建交易。最初真实返回400 INVALID_REQUEST，未签名，脱敏说明为缺少Accept或User-Agent。已在共用HTTP传输层补固定User-Agent，覆盖主服务、查询转发和资金操作转发。修复后真实返回404，微信响应签名验证通过、商户查单被接受。本次证明商户请求签名及微信公钥验签可用，不证明APIv3通知解密、真实收款、退款或到账。

同时按微信官方普通商户查单错误码文档补DIRECT模式ORDER_NOT_EXIST兼容，保留旧ORDERNOTEXIST；始终先验签，不释放付款预留。相关查询/转发/探针测试28项通过。官方依据：https://pay.wechatpay.cn/doc/v3/merchant/4012526919 。

四个服务的User-Agent修复已完成代码更新。prepare-company-merchant-config.ps1已准备五个服务的正式材料关闭配置：私钥/APIv3只给支付主服务和回调，转发/防重只持有商户公钥；配置目录受当前用户和SYSTEM访问限制且Git忽略，未开启资金操作。正式配置部署与云端回查进行中，完成状态以随后证据为准。

实时只读检查公司库防重表payment_mutation_receipts：am_payment的INSERT表级授权计数为0。已向用户请求仅增加INSERT权限，未收到确认前不执行授权。

正式材料部署已完成：payment-mutation-guard、payment-query-relay、payment-mutation-relay、payment-api、payment-notify全部成功。支付主服务及回调各14项真实配置布尔核验通过，三个配套服务配置及实际关闭拒绝均通过。后续审计需使用--merchant-configured选项，对照受限目录merchant-configured-closed中的配置；旧无材料closed配置已不再代表当前云端。公网POST空报文返回403 PAYMENT_SIGNATURE_INVALID，已由缺配置503进入验签门禁。

用户明确确认允许增加防重表权限后，已执行限定账号来源的GRANT INSERT。实时回查payment_mutation_receipts对am_payment仅一条INSERT、IS_GRANTABLE=NO，来源172.17.0.0/255.255.240.0。该授权依赖已关闭，不要再次请求或声称仍待批准。

剩余：开启并验证查询/资金转发与防重链路，真实双账号订单及真机由用户完成付款，真实微信通知/APIv3解密、商户到账核对、退款/账本/提现与正式上线仍未完成。当前所有资金开关仍关闭，不把本机只读微信探针当云端调用或真实支付验收。

## 2026-09-25 云端只读转发及防重真实验证

payment-query-relay已启用，只读GET经真实SCF转发至微信，返回404且微信签名验签通过（transport=company-cloud-query-relay，2026-09-24T17:25:13Z）。这比此前本机直连验证增加了实际云端出口证据，仍未发生真实付款。

payment-mutation-guard已启用，使用真实商户签名调用同一防重请求两次：第一次consumed=true，第二次consumed=false；实际新增一个请求摘要。仅调用私网防重，未调用资金转发，没有向微信发出该POST请求。数据库即时计数：活跃账号1、BUYER账号1、PROVIDER账号1、订单0、付款0、请求摘要1。该摘要是本次防重验收记录，不是付款记录。

三个配套服务真实回查：查询转发和防重enabled=true，资金转发enabled=false；配置一致，全部非法请求拒绝。审计命令需增加--merchant-configured --query-enabled --guard-enabled；关闭配置文件保留用于明确回退，不应覆盖当前启用状态。付款主服务prepayEnabled仍false，结算仍关闭。

新增云端只读探针路由及仅防重探针，密钥不出现在工具输出或命令参数。相关探针/防重7项测试通过。准备了company-payment-phone-20260925真机副本，260文件源/副本哈希记录，仅前端云连接开关不同，二维码上传进行中；不能把上传当双账号或体验验收。
真机预览已上传成功，CLI exit0，包体1225654字节；二维码D:\code\Codex-Generated\anime-master-preview-20260925\company-payment-preview.png已检查为完整二维码图，source-manifest.json已标记uploaded=true、runtimeAccepted=false。此前中断发生在上传完成之后，未重新上传。当前向用户交付第二微信账号注册入口，双账号验收尚未完成。

## 2026-09-25 退款渠道基础实现（本地，未开放）

检查确认当前项目没有完整退款存储/审批/执行流程。新增cloudfunctions/payment-api/wechat-refund.js，沿用官方普通商户POST /v3/refund/domestic/refunds及GET /v3/refund/domestic/refunds/{out_refund_no}：固定原交易和退款单号、整数分金额、商户归属、DIRECT模式、审批态、独立关闭开关及专用退款通知地址。返回先验签再核对原付款/退款/交易号和金额，不输出收款账户描述；提交仅记PROCESSING，最终状态需查询/通知。无自动重试；当前relay未接退款路径时明确拒绝，不绕过已配置转发。

wechat-refund.test.js六项测试通过，覆盖签名、重复构建保持原退款号、非法输入、受理与成功区别、四种查询状态、错绑定/金额/时间/签名拒绝、HTTP失败单次请求、禁止绕过转发。仅测试夹具，无真实退款；未部署、未增加公共入口、未更改云端开关。

仍需实现退款申请/审核/预留与累计上限、同原单号恢复、资金冻结与互斥、退款通知及转发、退款账本冲正、真实退款验收；该适配器不能作为完整退款能力验收。官方依据：https://pay.wechatpay.cn/doc/v3/merchant/4012791862 与 https://pay.wechatpay.cn/doc/v3/merchant/4012791884 。第二个真实微信账号注册仍待用户完成。

## 2026-09-25 退款累计金额与费用冲正计算

fee-policy.js新增refundAllocation，按原付款保存的PLATFORM_20_PERCENT_V1及平台费用快照校验，用累计退款前后保留金额的份额差计算本次平台/服务方冲正，避免每笔退款分别乘20%产生取整误差。拒绝未知费用版本、被改动的原费用、非整数/负数/累计超退；全额退清后双方保留份额为零，采用安全整数及既有BigInt取整。

费用测试7项、退款渠道测试6项共13项通过。覆盖100元退30元的平台6/服务方24、1至200分订单逐分全退每一步守恒、不同拆分等价、最大安全整数及无效输入。仅本地数学与渠道适配器，不涉及真实资金；尚未接入退款审批/预留记录、资金锁、账本落库，不可宣称退款已可用。未部署、更未修改支付开关。

## 2026-09-25 退款冻结与争议冻结衔接修复

本地资金互斥实现发现：先REFUND_REQUEST再DISPUTE会因COALESCE保留退款原因，后续退款解除可能失去争议标记。funds-interlock.js改为DISPUTE优先且不可被后续退款请求降级；原最早held_at保持不变。退款流程未来解除自身冻结时仍必须识别争议及其他活动退款，不允许据此自动解除全部冻结。

本机MySQL 8.4.11端口33317的完整103项支付集成测试通过。扩展用例实际验证退款→争议→退款后仍为DISPUTE、原冻结时间保留、结算被阻止且无提交尝试。结果.artifacts/payment-mysql/refund-interlock-result.txt。仅本地测试实例与临时测试数据库，未连接公司库写入、未部署这次修复、未改变线上支付开关。测试数据库由套件清理，随后请求正常关闭本机MySQL。

本轮尚未新建退款申请/审批存储表或实现账本写入，不能把资金锁衔接修复当完整退款流程。第二个真实账号注册与真实订单验收仍待。

## 2026-09-25 退款申请持久记录与金额预留（本地）

新增0037_order_refund_requests.sql及refund-store.js。退款记录关联原订单/付款，保存固定退款ID、幂等键、原交易、金额/原费用版本快照和人工结算复核标记。内部入口须由控制层解析真实买家/商户；本轮未增加公开退款API。

锁顺序沿用订单→付款→退款记录→资金互斥，申请与REFUND_REQUEST冻结同事务提交。重复请求金额/原因不变才复用原记录；REQUESTED/APPROVED/提交中/处理中/成功/异常记录均占原单可退容量，仅REJECTED/CLOSED不占用，防止多申请超退。原付款必须DIRECT、PAID且付款人核对通过；未知费用版本/未支付/异商户拒绝。争议标记保持，已有结算占位则settlement_review_required=1，仅创建REQUESTED，不授权实际退款或垫付。

真实本机MySQL完整108项集成测试通过，新增5项覆盖20并发相同申请、并发不同申请超额竞争、异买家及改参幂等冲突、争议/在途结算标记、未支付及错误费用快照事务回退。结果.artifacts/payment-mysql/refund-request-result.txt。0037仅在临时测试库执行；未迁移公司库、未增加公司账号权限、未部署，付款仍关闭。临时测试库已由套件清理，测试实例随后正常关闭。

剩余审批证据和身份授权、拒绝/批准事务、退款执行与恢复、渠道通知/查询、费用冲正账本、UI及真实资金验收。第二账号注册仍待用户完成，不把本地记录表当完整退款能力。

## 2026-09-25 退款审批持久记录与释放规则（本地）

扩展尚未上线的0037迁移，加入审批决定、审批人、证据引用、审批时间与数据库状态一致性约束。refund-store.js新增内部reviewRefund：控制层必须先核验真实审批人和资金权限，不接受客户端自行声明审核权限。相同决定/人员/依据幂等复用；冲突审批不覆盖先前决定，记录审批依据后仅进入APPROVED或REJECTED，审批不提交微信退款。

批准时重新锁原付款/退款/订单资金，核对原费用快照、累计金额、争议与结算占位。已有结算或争议需单独处置，不自动垫付。拒绝后释放该申请占用的额度；仅当没有其他活动或成功退款、无争议、无结算占位时解除纯退款冻结。拒绝不解除其他案件的资金占用。

本机真实MySQL113项集成测试通过，新增5项覆盖并发相同审批、批准/拒绝竞争、多个退款逐项拒绝后占用释放、后到争议、在途结算。证据.artifacts/payment-mysql/refund-review-result.txt。临时库已清理，本机测试MySQL已请求正常关闭。未迁移公司库、未开放控制层/API、未配置审批人权限、未部署或触发真实资金。

后续退款执行租约与结果恢复、通知与查询、账本冲正、真实身份入口和页面及实际退款仍待；第二微信账号注册仍待。

## 2026-09-25 退款提交持久防重及租约（本地）

0037草案增加首次提交时间、提交租约和渠道退款号；新增refund-execution.js。审批通过后按原锁顺序重新核对付款/费用快照/累计占用/争议/结算占位，再持久化SUBMITTING。并发只有一个领取者；同付款存在未决退款时不提交下一笔，已结束退款与下一笔之间保留至少一分钟提交间隔。

一旦持久化首次提交，超时/错误/进程中断不会清空标记或生成新退款号。租约内BUSY，之后QUERY_REQUIRED；渠道受理仅写PROCESSING。无效回执/剩余时间不足保留原提交标记，未来须同单查单恢复。资金冻结不随受理释放。默认云端转发尚无退款路径时明确拒绝执行，不绕过该网络/防重层。

真实本机MySQL119项集成测试通过，其中新增执行场景涵盖20并发仅一次模拟渠道提交、超时后重读及租约过期不重发、在途退款/后到争议阻止新提交、时间预算不足、关闭态不触库、错退款回执保留SUBMITTING。渠道为测试替身，没有调用真实微信退款。结果.artifacts/payment-mysql/refund-execution-result.txt。临时库已清理，随后正常关闭本机测试实例。

未迁移公司库、未部署、未开放退款或付款。还需实现同单查询恢复及终态持久化、退款通知、账本冲正、受控转发、授权控制层/页面与真实退款验收。第二微信账号注册待用户完成。

## 2026-09-25 退款查询恢复与冲正落库（本地）

新增 refund-results.js；0037草案新增成功时间与order_refund_reversals。已验证：提交未知沿用原单查询，查询失败保留提交状态；10并发成功只生成1条冲正；迟到处理中不降级；金额不符拒绝；3001分与6999分累计退款精确冲正平台2000分和服务方8000分；注入结果更新失败后冲正记录与状态一起回滚；关闭退款不释放争议冻结。

证据：.artifacts/payment-mysql/refund-results-result.txt，125项MySQL集成测试全部通过，渠道使用替身，没有真实退款。公司库未迁移0037、没有部署本轮代码；成功退款继续保留资金冻结，直到完整订单/收益账本更新接通。通知、转发、审批权限入口、完整账本及UI仍待。正式支付和上线未完成。

## 2026-09-25 退款通知接入（本地）

官方依据：https://pay.wechatpay.cn/doc/v3/merchant/4012791906 。通知original_type为refund，事件SUCCESS/CLOSED/ABNORMAL，解密后使用refund_status且金额对象没有currency；实现使用原退款单的CNY快照，仅缺省时补齐，仍拒绝显式异币种。查询结果与通知复用规范化和事务落库。付款通知仍只接受TRANSACTION.SUCCESS。

新增refund-notifications.js、handleRefundHttp、index.refundNotify，共用原始字节验签和AES-GCM解密。HTTP只有事务成功才204；失败返回非成功且不暴露原始请求或数据库错误。测试有效加密通知及重复通知、伪造签名、异商户、错单错金额和事件状态冲突。测试夹具原先支付transaction_id为35字符，修正退款专用夹具为符合官方32字符上限，未放宽生产校验。

证据：.artifacts/payment-mysql/refund-notify-result.txt（127通过）；refund-notify-unit-result.txt（43通过）。均为本地测试材料，不是真实微信通知。公网退款路由尚未部署，0037未迁移、退款转发与权限配置及完整收益账本未接通；保留成功退款资金冻结。云端正式付款开关未改。

## 2026-09-25 退款只读查询转发已部署并实测

query-relay只新增/v3/refund/domestic/refunds/{32位内部ID}的GET白名单，仍验证商户对完整路径的签名。主服务本地queryRefund使用既有转发客户端，并校验微信响应签名；404保留未知状态，不释放退款或允许重发。退款提交转发仍未实现。

退款/查询转发13项测试通过，探测脚本原有3项通过。云端payment-query-relay仅更新代码，保留现有环境配置；三个relay/guard配置审计及无效请求拒绝通过，资金转发仍disabled。真实云端随机不存在退款查询：2026-09-24T18:35:03.776Z，HTTP404，PROBE_REFUND_ABSENT，responseSignatureVerified=true，merchantQueryAccepted=true。没有创建退款/支付、没有SQL写入，不代表真实退款到账或APIv3通知解密验收。

尚待：主服务本地退款代码部署、0037迁移与必要权限、退款提交转发、完整收益账本/UI、真实双账号支付退款及到账。不得把只读渠道连通记为支付上线完成。

## 2026-09-25 退款提交转发（本地）

mutation-relay增加限定退款POST路径及字段白名单，绑定独立refundNotifyUrl和refundEnabled开关；拒绝资金账户覆盖、金额超原单、非人民币和非法退款号。私网guard同样要求独立refundEnabled，先记录已签名请求摘要再允许公网提交；重验签以拒绝防重检查耗时后已过期请求。主服务submitRefund接既有mutateThroughRelay，仍验微信响应签名；executeRefund先持久锁定退款单，未知结果保留原ID查单，不自动重发。

21项渠道/防重测试通过，127项MySQL集成回归通过（.artifacts/payment-mysql/refund-mutation-result.txt）。本次新转发防重用测试存储替身验证，MySQL回归另覆盖申请/审批/执行/未知恢复和通知，不冒称真实微信退款或新路径云端防重实测。

本轮资金转发代码未部署、退款开关未启用、公司库0037未迁移、权限未扩大。下一步接完完整收益账本和授权入口，准备迁移及最小权限清单后再推进配置部署。总体正式上线和真实资金闭环未完成。

## 2026-09-25 公司直收业务账本第一段（本地）

0038新增fund_journals/fund_postings，付款/退款各自业务唯一事件键；退款关联原付款账。CHANNEL_RECEIVABLE借、PLATFORM_PENDING和PROVIDER_PENDING贷，退款反向记账；基于原订单费用快照，零金额科目不记。仅为业务应收/待结算记录，不代表微信可用资金或可提现余额。

postFunds由正常DIRECT付款确认与成功退款事务内调用。异常付款仍PAID_REQUIRES_REVIEW，异常资金科目尚未实现；旧COMBINE链路不迁移账本。公司现存历史付款回填尚未设计，部署前必须重新核实数据，不允许对有既有付款的库直接假定从零开始。

128项本地MySQL集成测试通过，.artifacts/payment-mysql/fund-ledger-result.txt。验证3001+6999分退款后3个科目净额均0，每笔借贷平衡；模拟付款分录插入失败时付款、订单、账本全回滚且后续重试成功；退款写状态失败时冲正记录和账本均回滚。更新两项旧DIRECT测试夹具为正式20%规则，未放宽账本校验。

未部署0037/0038及本轮代码，无真实资金操作。下一步修正funds-core收益读取，接余额分桶/收款资料/提现状态与权限；当前收益接口仍按原付款计算，不是已验收页面。数据库最小权限和历史数据核查须在部署前完成。

## 2026-09-25 退款后的收益净额（本地）

0039为order_payments新增refunded_fen/platform_refunded_fen/provider_refunded_fen，默认0、非负、有上限且合计一致；作为可重建汇总，与退款成功、冲正记录、业务分录同事务写入。原支付金额和费用快照不修改。部署前若已有退款记录必须按冲正记录回填，不能默认历史均0。

funds-core直接读取同一付款行汇总，返回原金额、累计退款、保留金额/平台费和净预计收益，避免多次请求累计退款明细时分页漏算。未知/非法汇总报错，不默认为0；待核对付款仍不返回预计收益，可提现金额保持null。服务方归属、付款时间+ID分页规则保留。客户端funds/index.js:54直接消费expectedIncomeFen，本轮无UI修改、未做真机验收。

134项测试通过（128 MySQL集成+6收益接口），.artifacts/payment-mysql/refund-projection-result.txt。含30.01元退款后预计收益55.99元、全退0、非法汇总拒绝、同时间分页不重复遗漏；数据库全退汇总10000/2000/8000，退款状态失败汇总回滚为0。

未部署0037—0039或本轮接口，需在迁移与必要权限落实后部署支付及order-api；余额分桶、异常收款账、收款资料和提现仍未完成。真实双账号、支付退款到账与正式审核发布仍待。

## 2026-09-25 公司库0037—0039已实际迁移

实时SELECT COUNT order_payments=0，新退款/账本表不存在；原付款表结构已保存在wechat-miniprogram/.artifacts/company-order-payments-before-refund.json。0037两语句、0038两语句、0039一语句全部执行成功；information_schema回查确认4张新表及3项BIGINT UNSIGNED累计退款字段。旧记录中的未迁移结论被本次证据替代；此为结构部署，不是功能/资金验收。

am_payment原权限实时回查：order_payments已有SELECT/INSERT/UPDATE，order_aggregates已有SELECT/UPDATE，funds interlock已有SELECT/INSERT/UPDATE，payment_mutation_receipts仅INSERT且无转授权。新表权限尚无，不重复申请旧表权限。

待用户批准的具体SQL：refund-ledger-minimum-grants-2026-09-25.sql，仅退款申请SELECT/INSERT/UPDATE，冲正SELECT/INSERT，journal SELECT/INSERT，posting INSERT。未执行权限SQL，无DELETE/DDL/GRANT OPTION。异步授权问题已发送，等回复后执行回查。主服务代码依赖新表权限，在批准并验证之前不部署以免影响回调。查询转发是前轮已更新版本；资金转发与付款开关保持关闭。

下一步：新表最小权限落地与真实受限账号检查、组装新版支付服务/通知和收益接口部署，退款HTTP路由/独立开关配置；余额分桶、收款资料、提现与双账号真实资金闭环继续待办。

## 2026-09-25 新结构正式审计已接入

automation/mysql-readonly-preflight.js扩展退款/账本4表及关键列、累计退款列、退款申请幂等/渠道号/冲正/事件与分录唯一索引。9项测试通过，含将唯一索引降为普通索引时明确失败。scripts/audit-company-payment-schema.js使用同一规则真实只读审计通过：columnIssues=[]、indexIssues=[]，orders/payments/settlements均0。

范围仍为所选字段/索引与数量，不代表全部约束、账号权限或业务验收。新表权限请求尚待用户答复，不以自动目标续行当授权；未执行grant文件，依赖新表权限的支付代码仍未部署。余额分桶/提现与授权入口可继续独立实施。

## 2026-09-25 退款申请身份入口（本地）

新增refund-request.js，payment-api.main注册requestRefund。独立refundRequestsEnabled默认关闭，客户端只能传订单、付款、请求幂等键、退款金额和原因。可信上下文AppID匹配服务端配置，解析ACTIVE/BUYER微信账号，再核对订单所有权及原付款AppID/payer；不能传buyerId、审批状态或开关。调用既有事务申请逻辑，结果仅输出申请ID、订单、金额、状态与时间，不暴露商户、渠道号、审批人、内部证据或租约。

130项MySQL集成与原12项入口回归通过，随后新增退款RPC分发/脱敏测试，入口13项通过。证据.artifacts/payment-mysql/refund-entry-result.txt记录142项组合运行；新增入口用例单独运行，不把该文件误称143项。重复申请仍REQUESTED、review_decision/submission_started_at为NULL；越权与超额不写申请。未调用微信退款，未部署/开启入口。管理员审批身份入口、用户退款UI与记录查询后续继续。

新表最小权限仍待用户答复，未执行grant；已迁移0037—0039保持，资金开关未改。

## 2026-09-25 退款进度查询（本地）

refund-read.js与payment-api.main的getRefund入口，只通过可信微信上下文关联ACTIVE需求方、订单归属、原付款AppID和payer、商户及退款。单次只读SQL返回金额、状态与时间，内部审批证据、商户号、渠道号和租约不输出。查询不调用退款提交或微信API；refundRequestsEnabled关闭不阻止历史记录查询，权限越界统一REFUND_NOT_FOUND。

132项MySQL集成及原13项入口组合145通过（.artifacts/payment-mysql/refund-read-result.txt），新增查询分发/脱敏用例后入口14项单独通过。验证审批中到成功状态、关闭新申请后的可读性、跨账号/商户/AppID拒绝和字段覆盖拒绝。未部署，不替代手机真实进度验收。

新表最小权限仍待用户确认；已迁移表不变，资金开关不变。退款列表/产品界面、管理员审批入口、余额分桶与提现及正式资金验收仍待。

## 2026-09-25 退款列表与管理入口核查

检索确认现有审核只有scripts/review-provider.js和qualification-review-core.js的特权脚本，没有可复用的管理员登录入口。没有把客户端传入reviewerId当管理员权限，未开放审批RPC；方案要求的受控内部页面仍需建设。

refund-read新增listOrderRefunds，payment-api注册listRefunds。先校验ACTIVE需求方订单归属，再限定原付款payer/AppID/商户查询；20条一页，多取1条判断下一页，创建时间+退款ID降序游标。只输出金额、状态、时间等白名单，支持用户丢失申请ID后按订单恢复进度，无渠道调用或资金动作。

133项MySQL集成+14项入口147通过（.artifacts/payment-mysql/refund-list-result.txt）；随后同一入口测试补列表分发及失败码断言，14项再次通过。验证25条同时间记录完整且无重复、跨账号与坏游标拒绝。未部署/未改UI、未真机验收。新表最小权限仍待用户回复，未执行扩权，余额/提现与正式发布仍未完成。

## 2026-09-25 内部业务账目一致性核对（本地）

新增fund-audit.js的auditPaymentFunds，给内部操作端使用，不注册小程序RPC。显式REPEATABLE READ只读事务，对单付款读取一致快照，检查成功退款/冲正/累计汇总、缺失付款或退款journal、退款原账关联、服务方/币种/费用规则绑定、借贷平衡以及逐科目金额方向。非DIRECT标为不支持，PAID_REQUIRES_REVIEW要求人工核对，不能以空分录报告正常。输出差异代码和内部ID，不修改记录，不调用渠道。

134项MySQL集成回归通过（.artifacts/payment-mysql/fund-audit-result.txt），最后补不支持模式/待人工核对标记后，针对本次核对用例单独通过（fund-audit-focused-result.txt）。故障注入涵盖借贷仍平衡但平台和服务方各错1分、缺退款冲正、汇总归零；核对准确报错且保留故障值，没有擅自修正。

该工具仅证明本地业务一致，不证明微信或银行实际资金；尚无管理端调用/部署、完整渠道账单导入与差异处置。内部审计需操作端独立只读权限，不因本工具扩大待批准的am_payment权限清单（fund_postings仍只申请INSERT）。新表权限审批问题仍待用户回复。

## 2026-09-25 退款批量补查（本地）

refund-reconcile.js与0040查询租约迁移草案：内部worker选取指定商户/AppID的已提交SUBMITTING/PROCESSING/ABNORMAL退款，最多5笔，每笔最短60秒间隔，30秒持久租约。订单→付款→退款锁顺序，释放仅凭本次token；查询失败不清提交标记，不重发退款。不公开RPC，不创建定时器，不操作真实渠道。

136项MySQL集成通过（.artifacts/payment-mysql/refund-scan-result.txt）；最后把AppID过滤提前到候选查询以避免其他应用记录占满批次后，2项并发/故障测试再次通过（refund-scan-focused-result.txt）。10并发扫描一笔未知退款只调用一次查询，结果成功落库；仍在提交中的记录跳过；超时结果保留，紧接扫描不重复请求。

0040仍本地未迁移，worker未部署/调度，不能宣称自动恢复线上生效。后续应将0040纳入结构审计、迁移并配置受控调度；实际渠道补查验收还需真实退款。新表权限仍待用户确认，余额/提现/管理UI/正式上线继续未完成。

## 2026-09-25 0040查询租约公司库迁移完成

迁移前information_schema确认order_refunds尚无query_started_at/query_lease_until/query_lease_token；0040单语句执行成功。新版mysql-readonly-preflight纳入三列及refund_query_due索引，9项测试通过；公司实际结构审计columnIssues=[]、indexIssues=[]，orders/payments/settlements均0。

本次只迁移查询基础结构，不开启refundReconciliationEnabled，不创建定时器，不部署worker，不扩大am_payment权限。当前已迁移0037—0040，依赖新表的支付主服务/退款通知/申请查询仍未部署，新表最小权限问题等待用户答复。真实支付退款、余额提现、双账号真机及正式审核发布仍未完成。

## 2026-09-25 五个待部署包及本地依赖检查

发现audit-function-runtime-dependencies只检查npm安装树，无法发现缺业务模块。新增local-module-audit递归检查字面量相对require文件（含函数内延迟require）；不执行业务代码、跳过node_modules及测试文件。测试证明安装目录存在但缺refund-results、或其下游ledger仍会报错，补齐后通过。该检查不声称覆盖动态构造的模块路径。

prepare-company-payment-relays固定清单补fund-ledger、query-relay-client、payment-timeouts，避免最新payment-store/wechat-query的本地依赖缺失。未执行会生成旧关闭态配置的prepare脚本，仅复制源码到现有暂存目录，保留所有现有商户配置。

本地更新并检查通过：.artifacts/company-payment-functions/payment-api；.artifacts/company-payment-notify-functions/payment-notify；.artifacts/company-payment-relays下payment-query-relay/payment-mutation-relay/payment-mutation-guard。五者npm树及本地模块审计均ok:true。未上传、未开放退款路由或定时器，未改变线上开关。查询转发云端仍是前次只读退款查单通过版本，不用当前本地暂存状态冒充已部署。

待用户确认新表权限后，执行最小授权并回查，再部署与闭态验收新版服务。独立余额/提现、管理端和用户退款页面仍须继续实现。

## 2026-09-25 小程序退款服务层（本地）

miniprogram/services/cloud-refunds.js复用cloud-orders.isAvailable与local-preview云调用限制，对接payment-api申请/查询/列表；请求编号必须由页面草稿持久保存并传入，服务层不生成新键、不自动重试未知提交。返回值按白名单，校验状态、金额、订单归属、退款ID与分页；外部错误只映射已知中文错误，不暴露SDK细节。

automation/cloud-refunds.test.js三项通过，覆盖原键保留、未知提交一次调用、内部字段剔除、身份越权字段拒绝、错单/未知状态/错游标与错误消息脱敏。

页面尚未调用该服务，草稿持久化/交互/设计目录登记仍待页面阶段完成，不能宣称小程序可操作退款。没有改UI、没有重新上传预览；新表权限仍待用户回复，后端新版暂存未部署。下一步按设计规范接订单退款页面与草稿/查询流程，同时继续管理审批及余额提现。

## 2026-09-25 退款草稿与客户端防重（本地）

miniprogram/data/refund-draft.js：以当前账号和订单隔离存储，DRAFT/UNKNOWN/ACKNOWLEDGED三状态。提交前先持久化编号和内容，存储失败不请求；同页双击合并，页面重建/超时沿用原键。UNKNOWN不能改金额/原因或另起草稿；成功返回后记录申请号，再次提交只查进度。首次明确拒绝可恢复可编辑；此前未知申请的重试被拒绝仍锁定，防止忽略已提交申请。切账号后迟到结果不改新账号草稿。

退款草稿4项+服务层3项共7项测试通过。首次新增草稿文件未实际落盘导致MODULE_NOT_FOUND，已重新写入并确认测试全部通过；不是线上运行故障。页面仍未接入、尚未上传或验收UI。后续页面需将草稿错误映射为可理解提示，并引导未知状态核对原申请，不生成新键绕过锁定。

权限仍等待用户确认，未扩权；后台新版未部署，付款/退款/提现和正式发布仍未完成。

## 退款页面接入（2026-09-25）

- 页面任务：需求方在本人已付款订单中申请退款并查看记录；实体为原订单、原付款、退款草稿与退款记录。
- 复用：editor-form字段层级、money金额样式、actions按钮、顶部/底部导航；页面仅编排，沿用深色与桃橙主题。仅新增退款页与订单详情入口，未更改服务方工作台。
- 状态：金额精确到分、不得超过原付款；原因最多80 UTF8字节；首次提交先持久化，未知结果锁定内容并沿用原键核对，成功提交与退款成功分开。记录分页失败保留已有记录，首屏没有读取提示句。账号改变清除旧画面。
- 横向检查：预约状态现有执行详情入口仍到订单详情；退款入口置于订单详情预约/执行分支外，已付款待履约也可进入。服务方直达被拒绝，未付款不显示入口；收益/结算页面未改变。
- 验证：order-refund-page.test.js 4项，refund-draft.test.js 4项，cloud-refunds.test.js 3项，共11项通过；design:check通过，目录28页。未刷新baseline。
- 未验收：当前9422端口无监听；320/375/390/414宽度与键盘、安全区、真机返回和双账号仍待完整画面验证。没有真实退款或上线。本轮未新增权限。

## 丢失申请响应恢复（2026-09-25）

原页面的未知申请恢复仅重试requestRefund，关闭新申请后会无法确认已落库申请。本轮扩展getRefund为两种互斥查询形态：退款ID，或订单/付款/原请求键；保留可信身份及商户/AppID约束，不新增公开管理接口。UNKNOWN草稿先只读查询，已存在直接恢复ACKNOWLEDGED，未找到才使用原幂等键提交；其他查询错误保持UNKNOWN不重发。

验证：真实本地MySQL137项通过，含关闭申请后的原键查找、其他账号/商户/订单/付款/请求键隔离及混合参数拒绝；客户端/页面/入口28项通过。证据：.artifacts/payment-mysql/refund-recovery-result.txt。本轮本地MySQL已正常关闭，两个暂存包更新并通过依赖审计。未部署，未执行待批准的SQL授权；真机、实际收款/退款/结算到账继续未验收。

## 验收至结算核查与收益校验（2026-09-25）

实际代码：order-api/order-core在两个需求方验收事件中原子保存COMPLETED与settlementIntent；payment-api/settlement-store对DIRECT明确报DIRECT_SETTLEMENT_NOT_ENABLED，现有子商户佣金任务不能直接当个人80%出款。原目标仍含公司直收、平台20%/个人80%、提现及到账闭环，未缩减为仅收款。

本轮修改funds-core收益读取校验：原费用快照与累计退款后保留平台份额必须符合PLATFORM_20_PERCENT_V1；金额相加平衡但分成偏移时拒绝展示，不静默修复数据。不改原支付/退款金额或提现状态。42项订单及收益测试通过，包含与支付fee-policy按分边界、全退和安全整数上限对照。未部署。

剩余结算工作：确定实际出款渠道及本人收款账户核验；实现公司直收验收后的应结额/冻结与可支取证据，持久化提现占用及原请求恢复，渠道最终到账与退款回退；不拿旧FEE_SUCCEEDED代表服务方到账。待批准新表权限仍未执行。

## 退款页面当前模拟器证据与连接恢复（2026-09-25）

Get-NetTCPConnection在受限环境拒绝访问，因此改用TCP连接实际核实：9422/9423连接拒绝，18255成功。沿用D:/WeChatmini/微信web开发者工具/cli.bat和运行中的IDE，无重启。首次CLI访问其用户配置EPERM，授权提升后auto成功，SDK Connection/MiniProgram实际连接成功。运行时AppID为空，不能以CLI显示公司AppID冒充可信身份。

通过自动化临时设置展示数据，不调用退款提交；application.png及unknown.png为当前完整模拟器截图，已逐张查看。发现新路由底栏未选中订单，main-bottom-nav/index.js仅新增order-refund到orders映射；unknown.png已显示订单选中。设计检查通过。第一次批量观察超时后重查同一IDE，当前页面已离开，随后重新做独立本地展示检查；不据观察超时重启IDE。

证据wechat-miniprogram/.artifacts/refund-page-runtime/layout.json明确标记local-fixture-not-payment-proof。只覆盖当前模拟器尺寸/静态申请和未知结果画面；真实云订单、键盘、四种宽度、返回后的业务恢复仍未全部验收。

## 公司模拟器运行身份复核（2026-09-25）

恢复既有company-account-validation-20260923的9423自动化连接。CLI确认登录true，project AppID为公司号，private useApiHook=false，基础库3.17.0。真实身份探针在云调用发送前返回APPID_MISSING；只清理编译缓存后复核仍相同，进一步使用SDK原生callWxMethod而非evaluate调用getAccountInfoSync，appId仍空、envVersion=develop。说明不是仅evaluate字段序列化问题，订单业务没有实际调用。没有清除登录/存储、没有重启IDE或更换账号。

结果文件wechat-miniprogram/.artifacts/company-order-readonly-runtime.json时间2026-09-24T19:40:38.718Z，ok=false，stage=identity，writesPerformed=false。此为当前失败证据，历史成功记录不覆盖本次结果。接下来真实身份运行环境仍需恢复；另一路真实设备双账号继续等待测试条件。无付款/退款或权限变更。

## 订单服务收益修复实际部署（2026-09-25）

80项order-api测试通过，运行依赖审计通过。部署前后audit-company-order-deployment均ok=true，主服务及私网占档Active，密钥一致、公私网边界及通知关闭态未改变。使用既有company-order-public-deploy.json执行fn code update order-api，观察同一任务73130至exit0，完成COS代码上传；未重复部署、未修改配置或权限。

第一次负向探针误用了listProviderFunds，返回AUTH_CONTEXT_MISSING只证明身份前置门禁；随后按源码真实getProviderFunds入口复验成功拒绝，最终证据.artifacts/order-funds-deploy-gate.json时间2026-09-24T19:45:15.759Z，请求43cee0c5-8a91-4a42-b752-0015478d33fa。无业务写入，不将此作为已登录收益/数据库列访问或真实订单数据验收。

退款后净收益及费用快照校验现已部署；主支付/退款新版仍待最小权限批准，资金开关未变，真实支付、退款、个人80%出款及到账继续未完成。

## 四表授权与新版支付服务部署（2026-09-25）

用户明确回复允许四张表最小权限后，执行既有SQL的四条GRANT：am_payment@172.17.0.0/255.255.240.0对order_refunds SELECT/INSERT/UPDATE，对order_refund_reversals及fund_journals SELECT/INSERT，对fund_postings INSERT。信息架构回查恰好8项且IS_GRANTABLE全NO，没有DELETE/DDL/转授权。证据refund-ledger-grants-applied.json与refund-ledger-grants-verified.json在wechat-miniprogram/.artifacts。授权等待已解除，后续不得重复索取或重新执行。

payment-api部署任务37840、payment-notify部署任务45251均成功exit0，仅fn code update，使用现有merchant-configured-closed配置。主支付、通知的部署审计全部true（新增退款三开关明确关闭检查），商户材料/数据库配置保持一致，公网关闭，DIRECT公司模式。未更新资金转发代码、未新增退款HTTP路由或开启worker。

真实负向入口检查：getRefund无可信身份拒绝AUTH_CONTEXT_MISSING，请求eda83794-8753-4310-bfa9-cff1905bfa70；通知GET返回405，请求3ab72687-3fa7-4adb-be73-bd3a2cab4542。证据refund-ledger-deploy-gates.json，时间2026-09-24T19:52:04.577Z。只证明部署与门禁，不证明受限支付账号完整事务/实际收款；本轮未做承诺中的本地受限账号完整退款账本演练，继续待办。无真实扣款或退款，资金开关未改变。

## 最小权限完整事务演练（2026-09-25）

在本地MySQL随机数据库/随机账号中只授予旧交易依赖权限和本轮批准四表精确权限。以该账号完成DIRECT付款预留与收款入账、退款申请、内部审批、退款领取、成功结果/冲正/汇总更新及重复成功处理。管理员侧核实退款3000分分配平台600/服务方2400，仅两条journal六条posting。

受限账号DELETE退款、UPDATE退款冲正、DELETE journal、UPDATE posting、SELECT posting全部被拒绝；没有增加SELECT posting或DELETE等权限。账号和随机测试库均在测试清理阶段删除，本地MySQL随后正常shutdown。

完整回归首次发现两项旧收益测试仍使用TEST_ONLY100分费用，不能通过已启用V1校验；修正这两项测试为原10000分订单V1平台2000分快照，不放宽生产校验。最终138项全部通过，证据.artifacts/payment-mysql/refund-permissions-result.txt。此是本地真实MySQL/渠道替身验证，不是云端真实付款/退款到账。生产代码本轮未修改或再次部署。

## 独立退款通知函数与公网路由（2026-09-25）

新增prepare-company-refund-notify.js，从受保护merchant-configured-closed/payment-notify.json复用现有配置与材料，独立暂存company-refund-notify-functions/payment-refund-notify，handler=index.refundNotify，不生成新密钥、不启用退款；git忽略检查使用单次已知仓库safe.directory，不改全局设置。依赖预检通过。

部署任务50796持续观察至成功exit0，期间函数未Active时没有重发或重启；最终所有配置检查true。新增路由/wechat-refund-notify到payment-refund-notify，地址https://cloudbase-d2g65rqbvee0bd978-1494174688.ap-shanghai.app.tcloudbase.com/wechat-refund-notify。原付款通知路由未改。

audit-company-refund-http.js实际验证GET405，无签名POST403且X-Payment-Error=PAYMENT_SIGNATURE_INVALID，响应未泄露材料。证据wechat-miniprogram/.artifacts/company-refund-http-audit.json，2026-09-24T20:03:38.056Z。只证明网关可达与验签拒绝路径；尚无正式签名退款通知解密/落库/到账。主退款配置的refundNotifyUrl、资金转发代码和worker后续继续接入；退款申请与执行开关保持关闭。

## 回调配置与退款转发代码更新（2026-09-25）

在既有受保护配置内只新增refundNotifyUrl（已部署/wechat-refund-notify）与显式refundEnabled=false，影响payment-api和payment-mutation-relay；原完整配置在同一受保护目录保存.before-refund-callback，不输出材料。首次config update停在环境变量交互选择，未声称成功；查CLI实际支持--yes后重新执行明确返回两函数配置更新成功。原有字段/密钥保持一致。

资金转发代码任务37028、防重代码任务9501均成功exit0。两包依赖审计通过，暂存12/2个JS与当前源码逐文件一致。payment-api关闭态配置审计全部true。三配套函数配置及无效入口拒绝审计2026-09-24T20:09:26.173Z通过；查询/防重保持启用，资金转发保持禁用。退款公网GET405/无签名POST403在20:09:27.633Z复验通过。

主执行与转发退款均保持关闭，没有发起退款、扣款或增加权限。查询worker尚未部署启用，实际签名退款通知/落库/到账、双账号真机和完整个人收益提现仍待。

## 退款補查函数实际部署与空队列验证（2026-09-25）

新增独立index.refundReconcile入口，只接受公司环境、恒定时间比较的内部随机凭据、无可信微信OPENID且无额外参数。拒绝发生在数据库连接前，公众RPC无此action；异常仅固定错误码/日志。入口16项测试通过，核心查询/租约及并发规则沿用已有MySQL验证。

prepare-company-refund-worker.js在受保护忽略目录生成独立凭据及配置，复用公司商户/私网材料，refundReconciliationEnabled=true仅为补查；refundEnabled/refundRequestsEnabled=false，其他资金开关false；无timer、无公网路由。独立函数payment-refund-worker(index.refundReconcile)部署任务18886成功exit0。

audit-company-refund-worker.js核对Active、配置精确匹配、私网/无触发器、无凭据拒绝；查询公司库refunds=0后执行一次内部凭据调用，返回enabled=true、examined/queried/skipped/failed全0。请求7124b424-9883-4cb4-9040-d7f2d3402fe9，证据wechat-miniprogram/.artifacts/company-refund-worker-audit.json，2026-09-24T20:14:25.695Z。证明真实受限数据库候选扫描及入口可用，不证明有实际退款时的外部查询/落库/到账。

仍待：定时器的受控触发封装、真实退款与签名通知闭环、审批操作入口和真实双账号验收；退款执行与付款仍未开放。本轮新导出仅部署独立worker，主支付/通知包不需要为未使用导出重复部署。

## 定时补查事件与调度配置（2026-09-25）

官方依据：https://cloud.tencent.com/document/product/583/9708（Timer、TriggerName、Time、Message），https://cloud.tencent.com/document/api/583/18589（CreateTrigger/CustomArgument）。agent-reach Exa本机调用网络EACCES，使用网页搜索核对官方文档。

入口支持固定名refund-reconcile-every-five-minutes的官方定时事件，Message严格为内部凭据对象，额外字段/缺失或错误凭据/微信身份在数据库前拒绝。17项入口测试通过；worker代码任务73081成功。以同样事件形态手动真实调用，空队列检查成功，请求a9f3e7f2-c7e3-447f-956f-06f2be482dbd；此不冒充自动调度。

CreateTrigger创建timer，名称refund-reconcile-every-five-minutes，cron=0 */5 * * * * *，Enable=OPEN，CustomArgument凭据仅保存在受保护配置/云端。请求a8d3514d-ab94-4afd-8790-1bfcaaf296f8。GetFunction回查Enable=1、周期和凭据匹配，证据refund-worker-timer-created.json、refund-worker-timer-verified.json。定时器通过SCF API独立管理，今后不要用无触发器的初始部署配置重建/覆盖worker；代码更新保留调度。

2026-09-24T20:21:16.089Z跨首时点后GetFunctionLogs依然TotalCount=0，保留refund-worker-log-observation.json；不能声明自动执行成功，也不能把零日志视为终止或直接重启。后续需监控调用指标/日志链证明实际调度。audit-company-refund-worker.js新增--scheduled验证已启用触发器，--timer-event验证手动事件形态，报告明确不证明自动执行。所有资金提交继续关闭。

### 退款定时器真实触发核验（2026-09-25）

- 只读使用腾讯云官方 QCE/SCF_V2 的 Invocation、Error、Duration，版本维度 $LATEST，查询起点为定时器创建后的 2026-09-24T20:19:00Z；期间没有手动调用 worker。
- 2026-09-24T20:20:00Z（北京时间04:20）记录调用1次、平台执行错误0次、运行5ms。证据：wechat-miniprogram/.artifacts/refund-worker-scheduled-metrics.json。
- 这证明自动触发已有运行记录，不证明业务返回 ok=true；当前 handler 会以正常返回表达业务失败，Error=0 不能替代业务成功证据。
- 只读 GetFunction 确认 ClsLogsetId、ClsTopicId 均为空，AsyncRunEnable=FALSE；没有创建收费日志资源或更改配置。业务结果可观测性、真实退款查询和到账验收仍待。
- 官方监控参数依据：https://cloud.tencent.com/document/product/248/45130 。无真实扣款、退款或权限变更。

### 定时任务业务失败上报与部署验证（2026-09-25）

- index.refundReconcile 保留原内部凭据、环境和非微信身份门禁。Timer 调用的拒绝、运行异常、补查关闭和批次 failed>0 改为抛统一 REFUND_WORKER_SCHEDULE_FAILED；直接内部手动调用仍保留原返回格式。异常不泄露数据库细节或凭据；重试仅涉及既有防重查询逻辑，不提交退款。
- 18项入口测试通过，新增数据库异常、部分失败、disabled和异常脱敏覆盖；worker部署包依赖审计通过。仅更新worker代码，部署会话5350成功exit0。
- GetFunction确认Active、ModTime=2026-09-25 04:29:33。04:30自动运行Invocation=1、Error=0；此时间段无手动调用。证据：wechat-miniprogram/.artifacts/refund-worker-result-monitoring.json、refund-worker-monitoring-deployment.json。
- 04:34:29部署后审计通过，配置与原定时器精确匹配、无凭据拒绝、真实数据库空队列enabled=true/examined=0/failed=0。请求127029ac-1dc7-4873-8a29-fab5fd8f3b4b，证据company-refund-worker-audit.json。这是单独手动检查，不混入04:30定时证据。
- 验收范围仅为空队列运行及失败可见性；真实退款单渠道查询/结果持久化/实际到账和告警通知配置仍待。未扣款、退款、扩权或新建日志付费资源。


### 最新支付退款真机预览（2026-09-25）

> 2026-09-25 最新支付退款前端开发预览已上传：company-payment-refund-phone-20260925，266文件哈希核对，仅启用公司云连接；发布配置检查与design:check通过。官方preview会话41358成功exit0，包1257137字节；完整二维码已查看，路径wechat-miniprogram/.artifacts/company-payment-refund-phone-20260925-qr.png。manifest uploaded=true/runtimeAccepted=false。等待第二真实微信账号扫码注册及双账号订单；付款退款仍关闭，未提审发布。
源项目保持原配置，既有旧预览目录保留；新副本包括退款页面、未知提交恢复与订单底栏归属修复。未将二维码上传或本地检查作为真实体验、双账号或支付验收。

### 双账号延期与退款内部操作入口（2026-09-25）

用户明确暂不进行第二账号测试，登记为待办；不得再把立即注册第二账号作为当前推进前提。双账号真机与真实资金闭环仍是上线验收要求，后续由用户安排。

本地新增 refund-operator.js 与 index.refundOperator 独立入口，使用专用 PAYMENT_REFUND_OPERATOR_TOKEN 和固定服务端 PAYMENT_REFUND_REVIEWER_ID，拒绝微信身份、未知环境、凭据/参数注入；公众 main 不分发该动作。refundOperatorEnabled 与 refundReviewEnabled/refundEnabled 分别默认关闭。审核复用既有事务，执行复用原单防重；审核通过不自动执行，结果只返回退款编号和状态，不泄露原数据库行。执行异常统一要求查询原退款单，不授权重建或重发。

25项操作/入口测试通过：含伪造审核员、公众入口绕过、配置注入、默认关闭、独立审核、BUSY/QUERY_REQUIRED/DEFERRED及错误脱敏。仅代码实现，未创建云端管理入口、未配置管理员凭据、未开放审批/退款，未进行资金操作；管理员交互/查询/独立部署及真实验收未完成。

### 退款管理员查询与归属门禁（2026-09-25）

新增refund-operator-read.js，只读退款/原付款/资金冻结的一次联表快照；限定配置商户、AppID及DIRECT身份，仅返回审核必要字段，不返回付款人openid、私密原始支付报文、渠道账号或租约凭据。独立操作入口新增read，在refundOperatorEnabled=true且付款退款审核开关关闭时仍可读历史；审核和执行先调用同一归属检查，之后仍复用原事务校验与防重。

26项入口/操作测试通过；完整本地MySQL139项通过，包含跨商户/跨AppID拒绝、待审/已审快照、金额与冻结状态、字段脱敏。证据.artifacts/payment-mysql/operator-read-result.txt。本地随机测试库清理并关闭MySQL。没有部署管理员入口、没有设置管理员凭据、没有操作生产资金；后台操作体验、列表/查询恢复和独立部署仍待。双账号测试按用户明确要求暂缓。

### 管理员退款队列（2026-09-25）

内部入口增加list，状态必填且限定已有退款状态；每页20条，按created_at/id倒序，游标绑定当前状态。与详情相同，数据库联表限定商户/AppID及DIRECT归属，不输出申请原因、审核证据或支付私密信息到摘要列表。仅开refundOperatorEnabled即可查询，审核与资金提交仍独立关闭。

27项入口测试和140项完整本地MySQL集成通过，证据.artifacts/payment-mysql/operator-list-result.txt。覆盖25条同时间稳定翻页、状态变更筛选、跨商户/跨AppID空结果及错用其他状态游标拒绝。本地测试库已清理、MySQL已正常关闭。尚未部署管理员入口、未设置操作凭据、未执行真实审核或退款。下一步管理员操作工具与独立部署；双账号验收继续待办。


### 本机退款查询工具（2026-09-25）

> 2026-09-25 退款本机只读管理工具完成：查询文件仅接受list/read，专用凭据经子进程stdin传递，不进入OS命令行，失败输出脱敏。30项工具/入口测试通过；操作说明见product-records/refund-operator-guide-2026-09-25.md。独立管理员函数及凭据尚未部署配置，审核/执行工具未完成，未操作资金；双账号继续暂缓。
工具与管理函数目标固定公司环境。内存argv桥接复用既有公司CLI，OS进程参数不含操作凭据；原始子进程输出不向用户透传。尚未真实云端调用，30项为本地测试，不作为管理员部署或资金验收证据。


### 退款管理只读部署（2026-09-25）

> 2026-09-25 退款管理只读服务已部署：payment-refund-operator/index.refundOperator任务8120成功exit0，无公网路由/无定时器/不含支付私钥，审核与退款执行false。云端配置精确核验、无凭据拒绝及本机stdin凭据工具查询真实待审核列表通过（0条）。技术查询身份refund_query_service不代表实际审核员；开放审核前须落实身份，审批/执行工具与实单到账仍待。双账号继续暂缓。
prepare-company-refund-operator.js仅复制数据库配置，支付配置重新按白名单生成且不含支付密钥；复用现有数据库权限，未扩权。部署后audit-company-refund-operator.js通过，证据wechat-miniprogram/.artifacts/company-refund-operator-audit.json，checkedAt=2026-09-24T20:53:19.158Z。操作指南同步实际状态。没有审批、退款提交或资金操作。


### 退款审核工具与响应恢复（2026-09-25）

> 2026-09-25 退款审核本机工具完成：prepare只读计划、apply重查原单/固定审核员后单次提交再读回确认，响应丢失不重发；已有同决定确认、冲突拒绝，技术查询身份不可审核。35项工具/入口测试通过，真实只读管理审计复验通过，云端审核/退款仍false。未实际审核或退款；执行工具、实际审核身份/授权和到账验收待，双账号暂缓。
refund-review-console.js复用私密stdin传输，审核计划包含退款/原订单/付款、金额、原因和固定审核员，提交前重新核对；不会自动串接prepare/apply，不支持execute。refund-operator-console.js的公开查询CLI仍只接受list/read，专用内部review桥接拒绝execute。35项本地测试通过；随后audit-company-refund-operator.js真实查询/关闭态复验通过（2026-09-24T20:56:50.796Z），没有发出真实审核动作。指南同步使用边界。


### 退款执行工具（2026-09-25）

> 2026-09-25 退款执行本机工具完成：只读prepare核对批准/金额/冻结，apply重查快照，已有提交记录仅查询，首次最多提交一次再读回；未知结果不重发，资金开关默认拒绝。40项工具/入口测试通过，指南同步。未调用真实execute、未更改云端配置，审核退款仍关闭；实际审核身份/授权、管理员体验与到账验收待，双账号继续暂缓。
新增refund-execution-console.js；原单执行计划绑定退款、订单、付款、金额及批准依据，现有提交时间构成不重发门禁。独立stdin执行传输只允许action/refundId，要求本地显式退款开关且云端仍有独立门禁。40项本地测试含响应丢失、反复运行计划、批准变化、未持久化和读取失败；不是实际退款验收。没有调用资金渠道、未重复运行已通过的数据库测试或部署。


### 异常收款待核对账（2026-09-25）

> 2026-09-25 异常直收账目本地完成：新增0041迁移草案，PAID_REQUIRES_REVIEW按渠道确认金额/币种记录CHANNEL_RECEIVABLE与REVIEW_SUSPENSE，不分配平台/服务方收入。对账验证暂挂金额及绑定且仍提示PAYMENT_REVIEW_REQUIRED；重复通知防重、写账失败原子回滚。142项MySQL与9项结构审计测试通过，测试库清理并关闭MySQL。0041未上公司库、代码未部署；生产新结构审计会报告此迁移待完成，禁止直接上传依赖代码。
0041扩展事件PAYMENT_REVIEW_RECEIVED及账户REVIEW_SUSPENSE，异常事件保留实际币种，正常付款/退款仍限CNY。payment-store与暂挂入账同事务，不因金额/币种/身份待核对而生成预计收益。fund-audit验证实际收款金额及两条暂挂分录，不把账目平衡当异常已解决。证据.artifacts/payment-mysql/suspense-result.txt。后续迁移/部署、异常处置及暂挂转回仍需完成；当前未增加权限或操作资金，双账号测试仍暂缓。


### 0041生产迁移与异常收款部署（2026-09-25）

> 2026-09-25 异常收款账目已迁移部署：公司库付款/账目均0时保存两表原结构，0041两条ALTER成功；结构审计columnIssues/indexIssues为空。payment-api任务55310、payment-notify任务49358代码更新成功exit0，部署后商户/私网/数据库及付款退款关闭态全部通过。未产生资金记录，真实异常付款通知/查单入账仍待验收，异常处置与暂挂转回未完成。
迁移证据wechat-miniprogram/.artifacts/company-ledger-before-0041.json和company-ledger-0041-result.json。迁移前明确旧枚举且付款/账表无数据，先保存SHOW CREATE TABLE后顺序迁移，未扩权、未删数据。主服务/通知暂存包依赖审计通过，代码更新保留原配置。部署后审计2026-09-24T21:09:38.737Z、21:09:40.270Z均ok=true。仅结构、部署和关闭态核验，非真实资金闭环；双账号测试按用户要求暂缓。


### 提现渠道核验前Chrome连接诊断（2026-09-25）

> 2026-09-25 提现渠道后台核验暂未取得：当前node_repl浏览器工具已可调用，Chrome选择成功但nameSession/openTabs通信失败；官方诊断在管理员上下文确认Chrome运行、Profile 1扩展installed/enabled=true、本机host注册correct=true。沙箱下缺注册项是假阴性，不能建议重装。Chrome技能要求打开指定profile窗口先取得同意，已异步询问；未打开新窗口/未操作商户。服务方80%实际出款渠道仍待核验，不能按已开通实现。
持久浏览器句柄chrome（浏览器ID4）已建立且完整操作文档已读取；两次会话调用返回nodeRepl.fetch request failed。原生通信脚本在沙箱中看不到管理员HKCU，管理员只读复查correct=true；不改注册表、不读取登录凭据、不安装或重启插件。下一步如用户允许，仅按官方open-chrome-window脚本打开Profile 1并重试一次。双账号真机仍按用户要求暂缓，后台渠道核验是独立事项。


> 2026-09-25 Chrome恢复授权已执行：用户允许打开Profile 1，官方open-chrome-window返回opened；随后复用chrome句柄重试仍nodeRepl.fetch request failed，未取得商户后台内容。此前Chrome运行/扩展启用/native-host正确均已核验，故不将失败解释为未安装、不自行重装。80%出款渠道待核验；继续不依赖浏览器的项目工作，双账号暂缓。


### 异常收款管理查询（2026-09-25）

> 2026-09-25 异常收款管理查询已部署：paymentReviews按公司商户/AppID限定DIRECT待核对付款，区分原金额/币种与渠道确认值，20条稳定翻页，不泄露付款人openid。33项入口与143项MySQL测试通过，管理服务代码任务74621成功，云端配置/无凭据拒绝/真实退款和异常收款查询均通过（各0条）。无扩权、无资金提交；审核退款仍关闭，双账号暂缓。
本地证据.artifacts/payment-mysql/review-queue-result.txt，云端证据wechat-miniprogram/.artifacts/company-refund-operator-audit.json，checkedAt=2026-09-24T21:23:44.156Z。复用独立管理凭据、原数据库权限和只读开关，不增加服务或公开路由。异常处置、暂挂账转回、真实资金/提现到账仍待；查询空列表不是实际异常处置验收。

> 2026-09-25 服务方退款只读权限本地完成：getRefund按退款ID与listRefunds允许订单所属ACTIVE服务方/PROVIDER角色读取公开7字段；需求方仍绑定原付款人，原请求键恢复保持需求方专用。角色移除/停用/订单归属改变/外商户隔离及原退款写门禁覆盖，144项MySQL测试通过，测试库清理并关闭MySQL。未部署、未增加前端服务方入口、未操作资金；双账号验收继续按用户要求暂缓。证据.artifacts/payment-mysql/provider-refund-result.txt。


> 2026-09-25 服务方退款页面本地接入：实际provider-request已付款订单新增退款记录入口，复用order-refund，服务方仅见金额/记录且submit/startNext拒绝，需求方申请与UNKNOWN恢复沿用。6项页面/导航测试及design:check通过，28页目录更新，无新增局部样式。当前9422无监听，完整画面/返回/真机未验收；前后端尚未部署此变更，双账号继续暂缓，未操作资金。


> 2026-09-25 供需退款查询后端已部署：payment-api代码更新会话36726成功exit0，暂存refund-read与源码一致；依赖审计通过，部署后商户/网络/数据库/资金关闭配置全通过。真实getRefund/listRefunds无身份均返回AUTH_CONTEXT_MISSING（InvokeResult=0），证据wechat-miniprogram/.artifacts/provider-refund-deployed-gates.json。有效供需账号真实查询、前端上传及完整画面仍待；双账号按用户要求暂缓，未真实付款/退款。


> 2026-09-25 供需退款最新版开发预览上传成功：company-payment-refund-phone-20260925-provider，266文件上传后哈希复核一致，仅云连接开关变化；官方CLI会话31773成功exit0，包1257975字节，完整二维码已查看。source-manifest记录uploaded=true/runtimeAccepted=false。前端已上传开发预览，非正式发布；服务方完整画面/有效账号查询/原生返回/真机资金闭环尚待，双账号继续暂缓。原预览保留。


> 2026-09-25 退款运行验收阻点已定位：官方auto恢复9422，系统API及运行中模块核验local=true/cloudEnabled=false；协议日志显示reLaunch至订单页超时，原生navigateTo回调明确navigateTo:fail timeout并仍停auth，captureScreenshot也超时。会话9045/30120/46626均terminal exit1。证据refund-page-runtime-current/protocol.txt与navigation-diagnostic.json。Computer Use可列窗口，但截图SetIsBorderRequired失败0x80004002；重选窗口后文本仅空窗格，无可用控件。不再声称工具不可调用或建议重装。验收脚本增加运行中本地模式核验和失败阶段记录，语法通过，完整画面仍未验收；无云写入/资金操作。


> 2026-09-25 退款分成对账补强本地完成：fund-audit按原20%快照独立重算每笔累计退款冲正，识别退款冲正/付款累计/账本同时记错仍互相一致及累计序列漂移，输出REFUND_ALLOCATION_MISMATCH且不修账。145项MySQL测试通过，库清理且MySQL正常关闭，证据.artifacts/payment-mysql/allocation-audit-result.txt。未部署/未扩权（am_payment仍无fund_postings查询权），不是渠道账单或银行到账对账。成功退款保留冻结规则不变，DIRECT剩余本金结算仍待实际渠道。上一轮Computer Use读取商户因无法可靠识别网址被工具安全检查停止，未取得产品状态，禁止绕过。


> 2026-09-25 管理资金对账入口本地完成：fundAudit/paymentId复用私有管理凭据，服务端AppID/商户/DIRECT限定且同一只读快照，返回差异不自动修账；CLI仅查询、不接受客户端范围。16项入口/工具及146项MySQL通过，暂存管理包依赖审计通过，测试库清理且MySQL关闭。未部署，待新增am_payment对fund_postings的SELECT授权（现有仅INSERT）；其他查询权限沿用。操作指南已补充，渠道账单/到账对账仍待。

