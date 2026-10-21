# 审核未知结果保护与回调恢复（2026-09-23）

## 本轮已实现（本地，未部署）

### 提交结果未知不得直接重发

此前任何异常都会把 SUBMITTING 写成 ERROR，导致微信已受理但网络超时／回执保存失败时可重复提交。现分开处理：

- 尚未调用微信时失败（如临时链接取得失败），或微信响应 result.errcode 明确为非零整数：ERROR，保留受控重试。
- 已发起微信调用后的抛错、适配器错误、无 trace 响应及回执落库失败：保留 SUBMITTING，resolved_at 为 null，不开放重发。
- 已拿到 trace 时，失败处理尽力将 trace 留在 SUBMITTING，供后续回调关联；若最初 PENDING 写入已提交但应答丢失，条件更新不会降级已经 PENDING 的记录。
- PENDING 更新必须有实际命中行，零行不再虚报成功。
- 此为防重复保护，不是完整恢复机制。适配器抛出的业务异常也暂保守留待确认，不凭错误数字猜测微信是否受理。

### 回调中断可由重复通知补齐

先以 trace＋原状态条件保存审核结果，再条件更新文件 PENDING 状态。若第二步中断，重复的同结果回调可补齐文件状态，并保留第一次结果的 resolved_at 和审核详情。并发竞争失败返回可识别错误以等待重试。

同 trace 已保存终态与新结果冲突时，拒绝覆盖并保留证据；不是自动认定某个结果更权威，需后续核查处理。仍不会复活 DELETED 或已隔离 REJECTED 文件。查询只在文件行实际 READY 时报告可用，不因先保存 PASS 就提前报告可用。

### 目录输入错误分类

价格、页数和游标非法时返回 INVALID_ARGUMENT，在数据库访问前拒绝；不再把客户端输入错误归类为数据库异常。null、数组、字符串请求体也返回明确参数错误。数据库记录的数值校验保持独立。

## 证据

- 新增回归先复现失败，再修复。
- 31 个云函数测试文件及两组跨入口安全测试：268 项综合回归通过。
- 随后补充“可确定失败仍能重试”和“PENDING 已写成功但应答丢失”两个场景，审核核心 15 项全部通过。合计本轮最终版本已有 270 个不同本地用例验证，未将重复运行累加为新增测试。
- 十并发重复回调模型只保存一份结果，竞争失败可在重试后收敛。此为内存状态模型，不是公司数据库故障注入或微信真实回调验收。

## 必须继续保留的上线待办

1. SUBMITTING 无 trace／进程中断／微信未知结果的查询或可靠回调关联机制，需核验通道能力；不能按超时直接重发。已知 trace 的第二次落库也可能失败，仍需监控和恢复。
2. 冲突回调需告警、人工核查入口及证据处理流程；本轮仅拒绝覆盖并返回重试，不宣称自动解决冲突。
3. 回调无再次送达时，已存终态与文件状态之间的补偿调度；本轮仅证明重复通知可修复。
4. 审核与取消的跨表原子协调、READY 安全回收、真实双账号和存储验证。
5. 目录数据库分页、索引及其他原待办不变。

未部署、未新增迁移、未购买、未改公司数据或访问微信资金接口；客户端 enabled=false 保持。没有 UI 变更。

## 2026-09-24 本人查询时补齐已保存的审核终态

getImageStatus现在可执行受限状态补偿，不再是对所有输入都纯只读的接口：先核验ACTIVE账号及文件归属，仅对已提交、仍PENDING且审核行有非空trace的PASS/REVIEW/RISKY/ERROR结果补齐文件状态。PASS映射READY，其他终态映射REJECTED，与既有回调一致；条件更新限定文件编号、所有者和PENDING，不修改审核结果、首次裁决时间或trace，不调用微信或存储。

条件更新零行时返回MEDIA_STATE_CONFLICT，不凭旧读值报告READY；数据库失败不报告成功，原审核证据保留供重试。删除/隔离优先提交时不能复活，其他账号不能触发修复。没有已保存终态、没有trace或没有完成上传时不补齐。submitImage仍不重复提交已受理审核。

新增测试先复现缺口后修复，改进数据库模型以真实执行资产归属/状态条件，而非无条件返回fixture。38项提交/入口/适配器/回调相关本地测试通过，覆盖重复查询一次更新、四类终态、并发删除隔离、其他所有者、无trace及更新失败后恢复。

这是按需补偿，不是后台扫描调度；用户不再查询且微信不重送时仍无主动恢复。真实公司故障注入/已裁决资产补偿写入尚未验收；不能以固定不存在文件的拒绝检查替代。后续调用者和验收工具须知getImageStatus可能写文件状态；现有--media只查不存在资产，仍无写入。

### 2026-09-24 微信真实图片审核及回调闭环通过（单张独立测试图）
company-media-upload-audit.js新增显式--review模式，独立pending/runtime证据文件。真实微信身份创建并上传一张未发布测试PNG，commit成功后仅调用一次submitImage，再观察getImageStatus；保存reviewAttempted，未知/已提交结果均不自动取消或重发。完成报告已存在时拒绝重新创建测试，必须核查旧记录。保留图片以供回调证据与后续引用保护清理验收，不改头像/橱窗/已有作品。
真实任务75167观察超时后恢复同一任务，最终ok=true、committed=true、reviewAttempted=true、reviewStatus=READY。证据wechat-miniprogram/.artifacts/company-media-review-runtime.json，含本次资产及文件编号。未使用本地替身审核或伪造微信通知。
公司库按此唯一assetId只读联合回查：asset_status=READY、review_status=PASS、has_trace=1、resolved=1、committed=1。既有回调逻辑是写入该审核终态的路径，状态查询最多补齐文件状态，不会写审核PASS；因此此单图已证明官方提交、真实审核通知落库及文件可用链路。尚不能区分这次文件READY是否由回调直接写入或查询补偿完成，故不声称已专门故障注入验证补偿写入。
本次保留一条READY测试资产、一条审核记录及一份极小云文件，未发布到公开内容。普通cancelUpload不允许删除READY；后续需在引用感知清理或精确测试资源清理中处理，不能通过改成PENDING绕过保护。上一轮取消测试仍是另一条DELETED记录。
关闭D01中上述单张正常图片真实链路缺口；违规图拒绝、双账号文件隔离、无trace未知提交恢复、无查询主动补偿及READY引用感知清理仍待验/待实现。无需再把所有微信图片审核标为完全未跑通。支付与正式上线未完成，目标继续active。

### 2026-09-24 真实数据库审核终态恢复验收
针对上一轮唯一未发布测试图新增scripts/company-media-recovery-fixture.js：先确认公司库，限定测试artifact资产编号、文件名、WORK_IMAGE及已提交PASS/trace；检查accounts头像、profile告示、work_images、draft/publication/project/order JSON引用总数为0。记录审核证据SHA256（trace、状态、裁决时间、更新时间、详情），拒绝重复注入。
按精确条件把这张READY测试图改为PENDING，模拟审核终态已写而资产写入中断；未修改审核行或其他图片。实际回查injected=true/references=0/verdictPreserved=true。此是受控真实测试写入，不能计为纯只读。
company-session-readonly-audit.js新增明确--recover-test-media模式，使用独立pending/runtime文件并从受控注入记录读取assetId，真实身份/会话/资料校验后调用正常getImageStatus。默认模式仍只读，恢复模式writesPerformed=true。65485观察超时后恢复同一任务，2026-09-23T23:52:33.109Z返回ok=true/mediaRecovered=true。随后独立数据库回查recovered=true/references=0/verdictPreserved=true，状态确为READY且原审核证据摘要不变。
证据wechat-miniprogram/.artifacts/company-media-recovery-fixture.json与company-media-recovery-runtime.json。证明受控真实数据中断后正常状态接口可收敛恢复；未新增微信提交，不伪造回调。未排除平台重复回调同时到达的可能，因此不声称对恢复写入执行者做了排他性追踪；代码层条件写入/竞争已由38项相关测试覆盖。
测试READY图继续未发布保留，未删除或绕过引用保护；主动后台补偿、无trace未知提交和双账号权限仍待完成。支付商业资格与精确新表授权等外部事项保持待确认，正式上线目标继续active。
