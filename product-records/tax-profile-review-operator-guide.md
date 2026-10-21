# 税务身份后台审核操作说明

四张税务表及关联约束已完成生产迁移，支付账号最小提交/读取权限已实测。审核管理账号权限、真实资料采集与统一纳税人映射尚未完成，不能直接按本文对生产账号执行审核。

## 使用边界

沿用已有服务方资质审核管理脚本方式，不开放小程序云调用。操作人必须持有授权数据库凭据；TAX_REVIEW_OPERATOR_ID用于审计标记，不是登录认证或授权令牌。普通支付运行账号不应取得身份审核写权限。

服务方申报的主体/居民身份/所得性质不能自动通过。财务核查真实资料与适用税务处理后，提供资料的内部证据引用；引用文本不是自动实名验证。证件不放进决策JSON、代码仓库、普通日志。

## 提交转待审核

运行 `node wechat-miniprogram/scripts/prepare-tax-profile-review-cli.js --prepare <私有准备文件路径>`。使用受限审核数据库账号的 ORDER_MYSQL_CONFIG，拒绝使用 am_payment；数据库身份权限才是授权依据，账号名称本身不是授权。连接强制验证 TLS。

解密配置使用 TAX_PROFILE_CONFIG 或 TAX_PROFILE_CONFIG_B64（二选一），含 encryptionKeyHex（64位小写十六进制）和 keyId，必须与原提交加密版本一致。不得放入命令行、仓库、聊天或普通日志。现阶段无生产资料密钥，不可用测试密钥解密真实资料。

私有准备文件包含以下两个对象，不包含姓名或证件号码：

- scope：submissionId、withholdingEntityId、appid、providerId，均来自受限后台的实际提交归属。
- classification：taxpayerReference（已核验的统一纳税人内部引用）、taxResidency（RESIDENT/NON_RESIDENT/NOT_APPLICABLE）、incomeNature（PLATFORM_LABOR/BUSINESS/COPYRIGHT/OTHER）、validFromPeriod、validThroughPeriod（YYYY-MM）。

纳税人引用不能临时按账号随机生成，否则同一人多账号的累计税额会被拆分。现已实现内部 bindTaxpayerIdentity 和本地迁移0049：受限审核人员提供已核验的规范化税务身份（jurisdiction、identifierType、identifier）、操作人和证据引用，绑定原加密提交；同扣缴主体下相同身份复用编号，跨主体隔离。审核准备读取该绑定并核对引用，不接受无绑定的手填编号。

身份索引使用独立32字节 HMAC 密钥，不存明文税务标识，不得复用资料加密密钥。首次使用锁定公司索引密钥指纹，后续变更拒绝；密钥需备份，不可直接更换来“恢复运行”。换证、多证件同人、错误绑定纠正和索引密钥迁移尚未实现，需人工核验后建立有审计的迁移方案，不能新建编号绕过。系统不猜测证件大小写/格式转换，规范化税务标识必须来自可信核验结果；当前尚无真实核验服务，绑定入口只完成本地验证。

绑定命令：`node wechat-miniprogram/scripts/prepare-tax-profile-review-cli.js --bind <私有绑定文件路径>`。额外环境变量 TAX_IDENTITY_INDEX_KEY_HEX 保存64位小写十六进制索引密钥，TAX_REVIEW_OPERATOR_ID 保存操作人审计标记。操作人不允许从绑定文件覆盖；该标记不能替代数据库访问授权。

私有绑定文件仅包含 scope（同上）与 verification；后者包含 identityVerified:true、evidenceReference、verifiedIdentity:{jurisdiction,identifierType,identifier}。这些是管理员完成核验后的输入，不是小程序用户声明。文件含敏感税务身份标识，应置于受限目录，按正式资料留存规则处理，不进入仓库、共享目录或日志。命令只输出 submissionId 与 taxpayerReference；将后者填入准备文件后运行 --prepare。同一提交的相同参数可重试，改身份/操作人/证据会拒绝，不覆盖原绑定。

0049的三表尚未生产迁移或授权，不能对真实资料执行准备。税务分类由受限审核人员核查后录入，不直接采用服务方自选结论。

命令只生成 PENDING 身份版本，不代表审核通过。输出仅版本编号和当前状态；相同提交、相同分类重试复用版本，改变分类拒绝，撤销后重试不会恢复。核心事务校验归属并解密，不向终端输出资料明文。随后使用下述独立审核命令。

## 决策文件与运行

管理员环境配置ORDER_MYSQL_CONFIG及TAX_REVIEW_OPERATOR_ID；连接强制验证TLS服务端证书，不提供关闭TLS选项。

私有决策JSON字段：

| 字段 | 要求 |
|---|---|
| reviewId | 本次决定的32位小写十六进制唯一编号；网络重试保留原编号 |
| profileVersionId | 待审核身份资料版本编号 |
| withholdingEntityId | 平台实际扣缴主体内部编号，不是商户号的自动替代 |
| decision | VERIFIED通过、REJECTED拒绝、REVOKED撤销 |
| evidenceReference | 经核验材料的内部引用，最长128字符 |
| identityAndTaxTreatmentVerified | 通过时必须为true，表示管理员已完成人工核查，不是用户自我声明 |

运行：`node wechat-miniprogram/scripts/review-tax-profile.js --review <私有决策文件路径>`。

该命令写审核状态及审核流水，不申报税、不扣款、不创建可提现余额。输出本次reviewId、决定及当前身份状态，不输出证件或纳税人明细。失败时不输出数据库异常细节，管理员须通过受限审计渠道排查。

## 重试与更正

同reviewId的完全相同重试返回原决定及当前状态；修改证据、操作人、身份版本或决定则拒绝。撤销后重试旧通过请求返回当前REVOKED，不恢复身份。拒绝/撤销的版本不能直接改回通过，应建立新版本后重新核查，历史核算快照保留。

生产启用前还需完成资料提交和统一纳税人映射、受限审核凭据及权限、真实审核证据留存；本轮测试中的合成审核记录不可用于生产。该工具没有赋予任何账户新权限，也不替代用户对生产权限变更的批准。
