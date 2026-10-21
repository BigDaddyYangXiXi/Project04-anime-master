# 反馈服务公司数据库结构接入

2026-10-07，承接用户批准的个人中心及内页开发。不涉及客户端上传、资金操作或生产权限变更。

## 迁移前证据

只读核对公司环境cloudbase-d2g65rqbvee0bd978，AppID由既有公司CLI守卫检查。确认support_requests不存在，媒体用途仅原有六种。首次基线比较拒绝执行，后查明管理接口对引号增加反斜杠转义；解析修正后六种用途精确匹配。

迁移前媒体表定义保存在wechat-miniprogram/.artifacts/support-schema-before-20261007/media_assets.sql，manifest保留时间、用途及迁移SHA256。此为结构快照，不是完整用户数据备份；原始管理接口返回的转义需要在恢复前核对，不得直接作为已验证恢复脚本。

迁移文件0055_support_requests.sql SHA256：5baac78fd641e96414f5b579a3a90ee744ff9ab21312a654a6c2e47d30a65a62。

## 已执行与核验

使用既有run-cloudbase-sql-migration.js的公司路径执行两条语句，退出0：新增空反馈表；扩展media_assets用途允许SUPPORT_IMAGE。不删除行、不修改资金表、不执行GRANT。

13:05:07 UTC回读：9列均符合类型及非空约束；主键id，support_owner_created(account_id,created_at,id)，support_queue(status,created_at,id)；kind及status校验包含预期值；反馈表0行；截图用途存在。收藏关系关注/喜欢仍各0，原有收藏索引保持，COUNT查询EXPLAIN使用目标复合索引且Using index。

完整只读证据wechat-miniprogram/.artifacts/me-service-readiness.json；读取脚本scripts/audit-me-service-readiness.js。未以空表、执行成功或索引命中替代实际用户和大规模验证。

## 后续与恢复边界

support-api尚未部署；媒体上传用途、清理引用、互动计数代码尚未上线。本次只有数据库前置条件完成，手机页面仍不可据此宣称新反馈功能可用。

后续按函数依赖准备部署，保持既有环境配置及身份鉴权，不因新表放松权限。部署失败可保留未使用的新表和兼容用途，不自动DROP；若后续已有反馈或截图，撤销结构前必须核对引用和保留要求。

客户端最近实际上传仍0.9.15；未同步唯一客户端、未改变开发工具运行模式、未请求被拒的工具连接。真实资金、冷启动1秒、完整双身份及平台上线目标仍未完成。
