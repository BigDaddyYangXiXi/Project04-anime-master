# 图片审核运维检查

在 `wechat-miniprogram` 目录运行 `node scripts/audit-company-media-health.js`。脚本先核对公司环境，再以单条聚合查询读取状态；报告在 `.artifacts/company-media-health.json`。不输出文件地址、账号、审核正文或凭据，不修改状态。

## 指标及处理边界

| 指标 | 含义与处理 |
|---|---|
| awaitingStorageCleanup | 已隔离且带删除标记、但尚未获得可靠删除确认的资产。包括取消中断、存储拒绝和文件不存在回执，不等于存储里一定还有文件。逐条核对后重试，不能直接改成DELETED。 |
| oldestCleanupAttemptAgeMs | 上述资产距最近一次记录的清理尝试的最大时长；重试会刷新时间，不是首次失败年龄，也不是自动删除授权。 |
| uncommittedUploads | 尚未提交上传；先核对客户端上传/取消结果。不能直接认定上传失败。 |
| committedWithoutSubmission | 文件已提交但无审核记录；核对客户端是否已进入审核提交，不能仅凭数量批量提交。 |
| submittingWithoutTrace | 正在提交且缺少流水号，可能仍在执行或结果不明。保留记录，不能按等待时长自动重发。 |
| awaitingVerdictWithTrace | 已有流水号，等待审核结果；检查微信推送配置、回调响应和既有证据，不重新提交同一图片。 |
| pendingWithoutTrace | PENDING 缺少流水号，不符合正常受理后的状态；需查原请求和落库过程。不能补造流水号。 |
| savedVerdictPendingAsset | 已保存带流水号的终态，但已提交的文件仍待审核。文件拥有者的正常状态查询可尝试补齐；运营不能伪造用户身份。失败或冲突时保留原裁决并核查文件当前状态。 |
| retryableSubmissionFailure | 文件仍PENDING，审核ERROR且trace为NULL，与现有重试领取条件一致。重试仍走正常拥有者入口和原子领取，统计工具不执行重试。 |
| readyWithoutAcceptedPass | 非订单交付用途文件已READY，但缺少PASS、流水号或裁决时间。优先核查并阻止错误公开；不能根据这个聚合值直接删除文件。订单交付当前有独立业务规则，已从本指标排除。 |
| oldestAwaitingAgeMs | 待审核文件中，从首次提交到数据库当前时间的最长观察时长。不是承诺时限或重试授权；暂无自动超时裁决。 |

assets、readyAssets、deletedAssets用于数量核对，不代表所有文件都已通过内容安全或完成物理删除。各指标可能重叠；本次聚合是单个查询时刻的快照，不保证后续状态不变。

## 当前限定证据

2026-09-24 实查共有3条独立测试资产：2条DELETED，1条未发布READY。审核等待和状态不一致指标均为0。READY图已取得真实微信PASS，并进行过受控状态恢复验收；它仍保留供证据追踪和后续引用保护清理。

更新快照2026-09-24T01:47:23.097Z：共有6条资产，4 DELETED、1未发布READY、1 awaitingStorageCleanup，审核异常均0。新增待清理记录来自仅prepare、从未上传测试；实际取消回执STORAGE_FILE_NONEXIST，未冒充删除成功。当前后台清理仍未部署。以上旧快照保留为历史，不作为现状。

此工具是人工排障入口，不是定时监控、告警发送、主动补偿或完整运维系统。仍需落实告警接收人、响应流程、日志保留及预算，才能关闭上线总待办F05。无trace的未知结果、真实双账号权限、后台补偿及READY引用感知清理仍未完成。

### 2026-09-24 媒体清理受控部署及真实拒绝验收
media-pending-cleanup SDK3.18.3依赖增加Axios0.33.0限定覆盖，安装后仍4项通告（1中危3高危）；27项清理测试通过。原cloudbaserc含hourly-media-pending-cleanup定时器，本轮未使用该配置。新增prepare-company-media-cleanup-deploy.js仅准备独立公司配置triggers=[]；随机32字节令牌保存在已核验Git忽略的.cloudbase-cli-config/company-media-cleanup-deploy.json，重复准备复用，不打印或进入客户端。
部署11068成功，包含此前入口令牌、严格删除回执、data.fileId和元数据环境/路径校验修复。audit-company-media-cleanup-deployment.js在2026-09-24T01:59:22.633Z实查Active、handler匹配、无触发器、令牌匹配，随后缺令牌/伪造Timer/错误令牌三类真实CLI调用均CALLER_NOT_ALLOWED，ok=true。证据.artifacts/company-media-cleanup-deployment.json。没有发送有效令牌、没有请求合法清理/删除或新增清理审计业务行；不是清理成功验收。
替代旧“后台清理未部署”，当前为已部署但未启用定时调用、未验收真实清理。仍待仅prepare取消可靠完成、延迟上传竞争、READY引用保护、持久化cloud://旧记录归属审计、受控单条真实清理及后续调度。不得用原默认配置意外恢复定时器。支付与正式上线目标继续active，无待观察进程。

### 2026-09-24 后台清理合法定点空执行与审计落库
新增audit-company-media-cleanup-noop.js，只从先前成功取消证据选取唯一测试资产，执行前真实只读确认公司库及该资产DELETED；本地写attempted防止观察失败后盲目重发。后台令牌由忽略配置读取，仅经CLI参数传入，不打印、存进artifact或发客户端。
真实65873于2026-09-24T02:05:36.943Z通过：目标仍DELETED、pending五项计数全0、readyOrphans=null、audit.saved=true；按返回runId回查media_cleanup_runs确认TARGET/SUCCESS、pending全0、无错误及无READY扫描。仅新增一条真实运行审计，未新增资产或触发文件删除。证据.artifacts/company-media-cleanup-noop.json，后续勿重新执行该一次性脚本或删除attempted记录以重试。
这是合法调用/数据库读取/幂等空执行/审计保存的限定实证，不证明过期文件物理回收、无文件取消或READY引用事务。仍无定时器，相关缺口继续待办；支付与正式上线目标active，无待观察进程。
