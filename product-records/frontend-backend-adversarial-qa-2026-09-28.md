# 前端关联后端对抗 QA（2026-09-28）

范围：上传、读取、审核、云函数业务校验和公开展示规则。用户已授权对此部分对抗 QA 并完善；不恢复已暂停的完整上线目标，不改变财务口径、资金开关或数据库权限。

## 已复现并修复

1. 上传提交原先直接取存储返回列表第一条，未确认它属于本次 fileId。错误文件回执和缺少 fileID 的回执均能越过校验。新增反例先出现 Missing expected rejection；修复为只接受唯一匹配 fileID 的成功回执，继续检查大小和类型。另测匹配项不在首位、重复匹配回执。
2. 发布资料时，同一图片编号同时用于公告和作品，原逻辑优先按公告用途检查，使公告图片越过作品用途限制。新增反例先出现 Missing expected rejection；修复为按作品和公告各自用途独立验证，保留所有权及 READY 检查。

修改限于 media-upload/media-core.js、provider-catalog-draft/publication-core.js 及对应回归测试；未修改客户端页面视觉或业务文案。

## 验证与部署

- 上传、审核提交、待审核清理、资料发布、公开读取、账号、档期、收藏、项目、微信回调及旧响应隔离等共 205 项本地测试通过，0 失败。测试证据：wechat-miniprogram/.artifacts/frontend-backend-adversarial-20260928.txt。不是所有前端业务的穷尽验收。
- 设计检查通过：28 页、21 模块，无新增样式债务；不是页面运行验收。
- media-upload、provider-catalog-draft 均已按现有 cloudbaserc 单函数流程部署成功。部署前核验 Active、运行时、入口、超时和空环境变量一致。
- 云端下载包校验平台 SHA256 后逐项比较两个修复文件，均匹配当前本地源文件。证据：wechat-miniprogram/.artifacts/frontend-backend-qa-deployed-20260928.json。
- 部署后两函数无登录身份调用均返回 AUTH_CONTEXT_MISSING。证据：wechat-miniprogram/.artifacts/frontend-backend-qa-live-20260928.json。没有提交有效业务数据、真实付款或退款。

## 尚未完成

- 当前官方开发工具 auto 启动返回成功，但 9425 无监听，company-auth-current-runtime 返回 CURRENT_RUNTIME_AUDIT_FAILED；未取得本轮登录态完整画面、真实上传审核回调及发布展示闭环。不得以测试/部署替代真机验收。
- 弱网待复现：cloud-catalog.uploadImage 对所有异常执行 cancelUpload；审核提交已到达但响应丢失时可能取消仍在审核的上传。尚未修改。需先模拟响应丢失，结合各上传消费者的等待、取消及页面退出行为，明确恢复流程后修复，不能把未知审核结果当作 READY。
- 原待办继续保留：公开作品定位/分页的全局一致性、真实审核回调乱序和重试、存储清理闭环。第二真实账号测试按用户要求暂缓。

结论：本轮两个已复现校验漏洞已修复、测试并部署；整个上传到公开展示链路尚未完成真实环境验收。

## 后续：上传弱网恢复本地修复

2026-09-28 上传弱网恢复本地修复：已复现submitImage响应丢失后错误cancelUpload；共用cloud-catalog改为只读查询原asset审核状态，不重复送审；查询失败或未知状态保留文件并报错，审核提交前失败仍清理。4项新增用例及旧响应/审核运行脚本共21项通过，设计检查通过。影响头像、公告、作品、需求目标和预约参考图；未改视觉。尚未重建/上传新客户端包，真机及各页面等待超时/取消仍待验收；不能称全链路完成。证据wechat-miniprogram/.artifacts/catalog-upload-recovery-20260928.txt。

上文弱网待复现项已由本次复现和本地修复取代。调用提交后无法恢复状态的文件保留，尚无跨页面恢复入口；保留和清理闭环仍须验证。原两个后端修复部署状态不变。

## 最新预览交付

2026-09-28 最新上传QA客户端已上传微信官方预览：company-payment-refund-phone-20260928-upload-qa，267文件源/副本SHA256一致，仅云连接开关差异；四项客户端测试文件已排除，未复制云函数。官方preview会话39138 exit0，1266309字节；二维码wechat-miniprogram/.artifacts/upload-qa-preview-20260928.png已查看，manifest uploaded=true/runtimeAccepted=false。包含最新审核响应丢失恢复修复，旧policy包不包含此次改动。现有账号真机上传/审核/保存/重进及弱网体验待验收，第二账号仍暂缓。未提审发布、改资金开关或真实付款。
