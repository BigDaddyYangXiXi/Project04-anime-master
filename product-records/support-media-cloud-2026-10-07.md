# 反馈截图与引用保护云端接入

本轮未修改/同步/上传唯一客户端，未上传用户图片、未创建反馈、未执行清理或资金操作。

## 线上基线与变更

官方CLI下载support-api、media-upload、media-pending-cleanup到.artifacts/me-cloud-readback-20261007。反馈服务5个自有运行文件/包清单与本地一致，补齐前轮源码回读缺口；不声称逐个验证全部依赖文件。

媒体上传仅media-core.js有差异，两个用途集合增加SUPPORT_IMAGE；清理服务仅ready-orphan-core.js增加support_requests归属引用。使用线上完整包作为暂存基线，只替换上述文件，保留线上依赖；共享鉴权与依赖预检通过，媒体相关33项测试通过。

通过fn code update分别更新，不使用全配置部署，不创建HTTP入口。更新后下载到.artifacts/me-cloud-after-20261007；上传5个、清理7个自有运行文件/包清单均一致。证据media-upload-support-readback.json、media-cleanup-support-readback.json。

## 复核经过与边界

上传服务代码更新返回后，首次状态/配置复核报POST_DEPLOY_CONFIG_MISMATCH。脚本当时未持久化瞬时状态与各字段差异，因此无法证实失败原因，不能断言仅为异步部署延迟，也不能声称全部前后配置等值。

没有重复部署上传服务。后续只读确认Active/Nodejs20.19/index.main/15秒/256MB、环境变量空、无VPC/无触发器、TCB_QcsRole；运行时、入口、超时符合现有登记，无身份媒体读取真实拒绝。证据media-upload-current-config.json、current-request-identity-audit.json。

修正部署脚本：部署前保存各配置字段摘要，失败时保存状态及差异字段，对明确更新中状态继续只读核对。清理服务本次更新前后Runtime/Handler/Timeout/MemorySize/Environment/VpcConfig/Role/Layers/PublicNetConfig/Triggers全部等值，最终Active。

清理7项实时检查通过：Active、入口、零触发器、原令牌一致、缺令牌拒绝、伪造定时器拒绝、错误令牌拒绝。未提交有效令牌，不执行删除。证据media-pending-cleanup-support-deployment.json、company-media-cleanup-deployment.json。

## 尚未验收

新反馈和截图的真实账号提交、审核回调、临时链接、本人/跨账号隔离、运营处理及微信原生完整操作仍待。saved-items计数更新仍未部署，不能将本次媒体更新当互动统计上线。首开1秒、真实资金及平台上线总目标保持未完成。
