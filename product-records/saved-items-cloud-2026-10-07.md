# 互动读取：公司云端接入记录

2026-10-07，承接已批准的双身份个人中心开发。未同步唯一客户端，未上传新版本，最近上传仍为 0.9.15。

## 实际结果

- 公司环境 `cloudbase-d2g65rqbvee0bd978`；公司 AppID 核对通过。
- 现有令牌保护的诊断函数临时增加固定只读查询；不接受调用者 SQL，不返回行内容。无令牌请求拒绝。
- `account_saved_items` 的 PROVIDER/WORK 两类 HEAD+exact 和 GET+exact 查询均成功，计数均为 0。四次查询分别 806、261、242、714ms，整次函数调用 4136ms；这不是小程序启动耗时，也不能证明 1 秒定位或大数据性能。
- `saved-items-api` 仅修改 `saved-items-core.js`。新增收到互动列表，完整本人收藏分页，收到互动精确计数；入口、鉴权、依赖清单保持原状。
- 更新后初次检查仍为 Updating，配置无变化。未重复部署；13:54:05 UTC 再读为 Active。完整 5524 个文件与待部署包一致，配置各字段摘要一致；匿名 listReceived 返回 AUTH_CONTEXT_MISSING。
- 18 项互动核心/真实 SDK 传输契约测试通过；12 项部署保护/固定探针测试通过。

## 发现并修复的部署偏差

已安装 CLI 的 `fn code update` 默认在线安装 Node 依赖。首次诊断恢复后，业务源文件恢复，但全包比对发现依赖变化；没有把命令成功当作完整恢复。

已通过明确配置 `installDependency:false` 恢复刚下载的原包，回读 5527 个文件完全一致，配置一致。公司部署入口现要求代码更新指定精确目录与配置、关闭自动安装，并检查实际包依赖；没有条件时在联网前拒绝。诊断及媒体更新脚本同步修正。

回查前轮媒体服务：media-upload 的 5527 文件、media-pending-cleanup 的 5530 文件分别与各自原待部署包全部一致。没有再次更新这两个服务。

## 证据和范围

- `wechat-miniprogram/.artifacts/rdb-exact-count-cloud.json`：真实计数结果及完整恢复确认。
- `wechat-miniprogram/.artifacts/rdb-count-restore-repair.json`：关闭安装后的配置恢复记录。
- `wechat-miniprogram/.artifacts/saved-items-interactions-readback.json`：状态、配置、全包哈希及匿名拒绝。
- `wechat-miniprogram/.artifacts/support-media-full-package-comparison.json`：两媒体服务全包复核。
- `.artifacts/saved-items-before-20261007` 保留原线上包；`saved-items-stage-20261007` 为更新包；`saved-items-after-20261007` 为回读包。

未创建收藏/关注/反馈测试记录，未伪造微信身份。真实账号正向读写、微信原生交互、非零规模性能仍未验收。历史 D03 全局作品归属及跨查询并发快照问题仍在总待办，不因本轮部署标为完成。

## 部署后的本地续修：作品归属跨页校验

首次19项回归中新增案例先失败：47份快照时最后作者作品被截断，不可被喜欢。现在按provider_id主键升序、每页20条、gt游标读全，再沿用原唯一公开作者规则；晚页出现同编号作品时拒绝新增喜欢。19项核心/SDK测试通过。

此段源码比已部署版本多出分页校验，尚未部署，前述5524文件回读只证明当时部署包。它修复默认截断，不解决公开快照全表遍历成本、发布与校验并发快照或D03全局归属索引；不能以本回归标记D03完成。

## 2026-10-08分页修复部署回读

承接用户要求做到产品并上传供查看，分页补丁已基于当前线上包部署。只有saved-items-core.js变化；配置前后等值，线上Active，完整5524文件与本轮待部署包一致，匿名listReceived拒绝。19项回归通过，未制造真实收藏或使用伪造身份。证据：wechat-miniprogram/.artifacts/saved-items-pagination-readback.json，以及saved-items-before/stage/after-20261008目录。此段覆盖上方分页补丁尚未部署的状态。

客户端仍0.9.16，未重复上传；后台设为体验版仍未完成。大规模归属索引、并发发布一致性和真实正向用户链路仍未验收。
