# 全页面读取与缓存复审（2026-10-08）

本次针对每次进入项目管理、开始整理重复读取的问题，检查全部 34 个登记页面、服务层及图片地址旁路。只修改读取复用和回显，不改变布局、交易规则或云服务。未上传。

## 读取策略

| 数据 | 策略 | 变更后的刷新 |
|---|---|---|
| 项目列表、详情、目标图片授权地址 | 同账号内存复用5分钟；同参数并发合并 | 创建、保存、关联/移出订单、订单/支付操作及媒体变动前后失效 |
| 订单列表（我的、工作台、合作、评价、项目归组等共用） | 30秒复用 | 订单和支付相关操作前后失效 |
| 供需档期 | 30秒复用 | 保存档期、订单/支付操作失效 |
| 公开作品、作者、发现及搜索结果 | 1分钟复用；筛选、游标参数分别缓存 | 草稿保存/发布、资料修改、档期变化失效 |
| 收到的喜欢/粉丝、资格状态、反馈列表/详情 | 30秒复用 | 对应服务写入前后失效 |
| 本人资料、偏好、本人收藏、橱窗草稿及本人概况 | 沿用既有15分钟缓存和写入失效 | 不重复增加第二层缓存 |
| 头像、橱窗图片地址 | 沿用15分钟地址缓存 | 账号和文件标识隔离；反馈附件本轮接入同一地址缓存 |
| 订单执行详情、支付/退款确认、资金、税务状态、图片审核状态、交付下载 | 保留实时读取 | 涉及履约/钱款/审核，不用短时展示缓存决定操作 |
| 帮助、协议、设置的静态内容及本地权限查询 | 本地读取 | 无需新增云缓存 |

## 一致性与边界

公共入口只缓存明确列出的成功读取，最多80个请求键；按当前账号、完整请求参数隔离，不落盘，不保存鉴权判断。退出清除，账号切换清除；失败不缓存。返回值深复制，页面编辑不污染别页。写入开始和结束均清除相关服务缓存（失败也清除），使迟到旧请求和写入途中读取不能成为新缓存；无关服务的写入不清空全部内容。远端他人修改在缓存期限后下一次读取可见，并非实时推送；项目最长5分钟、公开目录1分钟、短缓存30秒。原有页面自身复用期限仍按原规则，不能将此表理解成推送新鲜度承诺。

我的页同账号返回保留项目文字，不再先清空成“正在读取项目”。缓存命中不产生真实云调用计时记录。首次冷启动仍需真实请求，不保证首次网络加载为零。

## 逐页入口清单

下表来自实际页面依赖检索；共享服务承接多页复用，原始生命周期检索留存于 .artifacts/read-entry-audit-20261008.txt。

| 页面 | 实际云服务依赖 |
|---|---|
| pages/discover/index | cloud-catalog、cloud-orders、cloud-account |
| pages/auth/index | cloud-auth |
| pages/search-results/index | 本地内容或共享组件；无页面直接云服务依赖 |
| pages/work-detail/index | cloud-catalog、cloud-saved-items |
| pages/provider-detail/index | cloud-saved-items、cloud-catalog、cloud-availability |
| pages/provider-schedule/index | cloud-catalog、cloud-availability |
| pages/booking/index | cloud-catalog、cloud-orders、cloud-account |
| pages/booking-status/index | cloud-orders |
| pages/order-detail/index | cloud-orders |
| pages/order-refund/index | cloud-orders、cloud-refunds |
| pages/provider-home/index | 本地内容或共享组件；无页面直接云服务依赖 |
| pages/provider-request/index | cloud-orders |
| pages/provider-profile/index | cloud-catalog、cloud-account |
| pages/provider-calendar/index | 本地内容或共享组件；无页面直接云服务依赖 |
| pages/provider-task/index | cloud-orders |
| pages/orders/index | cloud-orders |
| pages/projects/index | cloud-projects、cloud-orders、cloud-availability |
| pages/project-detail/index | cloud-projects、cloud-orders |
| pages/brief/index | cloud-projects、cloud-catalog、cloud-account |
| pages/fulfillment/index | cloud-orders |
| pages/review/index | cloud-orders |
| pages/provider-orders/index | cloud-orders |
| pages/provider-reviews/index | cloud-orders |
| pages/me/index | cloud-account、cloud-orders、cloud-catalog、cloud-saved-items、cloud-projects |
| pages/account-profile/index | cloud-account、cloud-catalog |
| pages/me-assets/index | cloud-saved-items、cloud-catalog、cloud-orders |
| pages/funds/index | cloud-orders、cloud-tax-profile |
| pages/account-notice/index | 本地内容或共享组件；无页面直接云服务依赖 |
| pages/home-preferences/index | 本地内容或共享组件；无页面直接云服务依赖 |
| pages/me-activity/index | cloud-orders |
| pages/help/index | 本地内容或共享组件；无页面直接云服务依赖 |
| pages/settings/index | cloud-account |
| pages/support/index | cloud-support、cloud-catalog |
| pages/me-social/index | cloud-saved-items |

## 验证与交付

72项相关测试通过。真实项目服务在本地受控传输测试中，连续三次读取列表、详情及图片共发3个请求（各1次）；保存后对应读取重新发出。包括退出/切账号、失败重试、迟到响应、写入途中读取、返回值隔离及全部缓存策略测试。设计检查通过。5个生产文件同步唯一公司客户端，哈希核对见 .artifacts/read-cache-sync-20261008.json。没有上传、部署、切换开发工具模式或写入云端业务数据；当前原生页面网络次数与完整运行画面尚未实测，不能以本地测试代替真机验收。

全客户端对比另发现两处本轮未修改的配置差异：home-preferences和order-refund的backgroundColorContent及格式；已留存，未扩大本轮范围覆盖。其余328个被比较文件一致（联网cloudbase配置有意排除），本轮5文件全部一致。
