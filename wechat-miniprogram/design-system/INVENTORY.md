# 全页面功能模块清单（自动生成）

来源：app.json、catalog.json、页面 WXML／JS／WXSS。修改目录后重新运行生成命令。

## 页面与界面分支

| 页面 | 身份 | 界面分支 | 功能模块 |
|---|---|---|---|
| 登录／注册 · pages/auth/index | shared | 登录；注册；成功／失败；品牌开屏／连接中；注册缺项与错误重试；微信隐私授权检查／拒绝重试／隐私指引阅读；手填手机号与短信验证码（未开放）；品牌开屏无读取文案；唯一昵称／用户名；微信手机号授权后注册；用户名2—12位大小写英文／数字／英文标点；协议为带连接词和句号的连续文本、自然换行；新注册默认未同意；单次点击注册直接微信手机号授权；注册成功固定需求方信息广场；已注册会话自动继续，无需再次点击登录；恢复失败可重试；首次用途弹窗；点击后微信模糊定位授权；拒绝/不支持可手选；头像昵称主动填写 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、表单字段与校验、作者／账号身份 |
| 发现／工作台 · pages/discover/index | buyer／provider | 按作品；按人；搜索层；筛选层；服务方工作台；已保存城市即时回显／后台核对；工作台身份先显示／统计随后更新；圆形头像／昵称与辅助文字分层；已注册冷启动静默恢复微信会话并进入作品列表；未注册/身份失败回账号入口；公开结果分页／触底与按钮加载／失败保留列表重试／筛选或离页丢弃迟到结果；作品模式按作品计数、同作者跨页合并、发布版本变化重读首页；工作台读取失败清除失效待办与统计、不显示无待办结论；原页重试恢复，重复点击/离页不启动重试；工作台切账号先清旧身份/待办/统计；读取途中换账号丢弃旧结果，旧订单入口核对账号；共用工作台：真实待办优先、紧凑订单分类、经营入口；未公开且无待办时引导搭建，不伪造草稿完成率；发现返回：五分钟内复用；发布失效或过期后刷新；同账号同查询刷新保留已有列表，失败可重试；工作台进入橱窗后未变更返回复用原画面；账号/发布状态失效或十五分钟到期再更新，搭建入口不随读取隐藏；已验证同账号最近五分钟缓存先显示，后台刷新；按身份/检索范围隔离；退出清除，不作为交易事实；会话明确草稿版本及公开状态；确认空橱窗不读草稿或公开目录，本人统计与草稿十五分钟复用，保存发布失效；首页即时显示并默认选择设备当天日期，未手选时跨日回前台更新，手选日期返回保留；授权所在城市、本人首选职业；无作品切最近有作品城市并说明；无匹配/定位拒绝手选；已授权每次前台开启重新定位，与会话并行；手选/退出丢弃迟到定位；首次用途弹窗；点击后微信模糊定位授权；拒绝/不支持可手选；头像昵称主动填写；正片设计稿：城市日期／原横滑职业卡片／搜索／自然比例作品卡；批准的hello及curious品牌表情按有内容与空结果展示 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、作者／账号身份、搜索、职业和筛选、作品列表卡、城市、日期与档期、订单列表／工作台待办、服务项目选择／编辑、评分、评价与回复、金额展示 |
| 搜索结果 · pages/search-results/index | buyer | 结果；搜索层；公开结果分页／触底与按钮加载／失败保留列表重试／筛选或离页丢弃迟到结果；作品模式按作品计数、同作者跨页合并、发布版本变化重读首页；已验证同账号最近五分钟缓存先显示，后台刷新；按身份/检索范围隔离；退出清除，不作为交易事实 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、搜索、职业和筛选、作品列表卡、金额展示 |
| 作品详情 · pages/work-detail/index | buyer／provider | 作品浏览；作者橱窗预览；草稿预览；收藏读取失败仍可浏览作品；关注/喜欢待同步禁用并独立重试；图片无链接使用共用不可用提示，不以原型装饰冒充图片；批准的正片系列阅读顺序：图片优先、作者服务分组、同一草稿预览与公开展示复用 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、作者／账号身份、作品正文与图集、关注创作者、喜欢作品、图片与附件选择／预览、服务项目选择／编辑、金额展示 |
| 服务者详情 · pages/provider-detail/index | buyer／provider | 需求方公开主页与预约；本人草稿与公开主页；案例服务须知档期切换；服务详情及关联案例；独立发布进度、成功、失败、未知结果及撤回；完整合作偏好与评价阅读分支及来源返回；档期页签按需读取真实月历、失败重试、切月及账号隔离 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、作者／账号身份、服务项目选择／编辑、城市、日期与档期、评分、评价与回复、作品列表卡、金额展示、关注创作者、草稿保存与公开发布阶段 |
| 公开档期 · pages/provider-schedule/index | buyer／provider | 选日期；服务方预览；预约按钮与日历可选状态一致；无效或过期入口日期恢复当天；跨日点击复核；档期读取失败按原入口重试；旧请求及离页结果不回写 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、城市、日期与档期、作者／账号身份 |
| 发起预约 · pages/booking/index | buyer | 全天；连续时段；多时段；再次预约；摘要核对；服务选择抽屉；地点编辑抽屉；时间编辑抽屉；需求编辑抽屉；联系信息抽屉；参考资料抽屉；输入弹层键盘展开／收起与字段滚动；提交时声明保密要求；资料读取失败与预约发送失败分别提示，保留具体服务不可用原因 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、作者／账号身份、城市、日期与档期、服务项目选择／编辑、表单字段与校验、图片与附件选择／预览、金额展示、合作确认与 NDA |
| 预约状态 · pages/booking-status/index | buyer | 待回应；已接受预约；补充信息；沟通；合作确认；保密约定；等待对方签署；待付款；付款待核对；合作已生效；未达成；补充信息抽屉；合作核对抽屉；加载失败；输入弹层键盘展开／收起与字段滚动；按订单权限查看私人参考图；微信订阅同意／拒绝／失败；不影响订单操作；确认弹窗绑定原订单版本；过期及离页不提交 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、订单事实、状态与进度、合作确认与 NDA、付款、验收与资金记录、表单字段与校验、金额展示、图片与附件选择／预览、订单通知订阅 |
| 订单详情 · pages/order-detail/index | buyer | 合作确认；NDA；付款后执行确认；执行中；已完成订单查看交付结果；按订单权限查看私人参考图；微信订阅同意／拒绝／失败；不影响订单操作；已付款需求方退款入口；交易完成后退款入口转记录与争议反馈；后台刷新保留已有订单画面；首次读取保持空白 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、订单事实、状态与进度、合作确认与 NDA、项目资料与订单关联、金额展示、图片与附件选择／预览、订单通知订阅 |
| 退款申请与记录 · pages/order-refund/index | buyer／provider | 本人已付款订单；金额和原因校验；未知结果沿用原申请；已提交与后续退款；记录分页与失败重试；账号变化清除画面；服务方只读退款记录／无申请表单；顶栏返回与底栏沿用订单身份；同版本返回保留退款输入；刷新失败保留表单并单独重试；交易完成关闭普通申请／保留退款记录与微信原生特殊争议反馈 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、订单事实、状态与进度、付款、验收与资金记录、表单字段与校验、金额展示 |
| 服务方工作台（兼容入口） · pages/provider-home/index | provider | 概览；紧急待办；共用工作台：真实待办优先、紧凑订单分类、经营入口；未公开且无待办时引导搭建，不伪造草稿完成率 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、作者／账号身份、订单列表／工作台待办、服务项目选择／编辑 |
| 预约与执行处理 · pages/provider-request/index | provider | 意向／补充／拒绝；联系方式；合作条件；报价；执行进度；交付；按订单权限查看私人参考图；微信订阅同意／拒绝／失败；不影响订单操作；已付款服务方退款记录入口；同版本返回保留报价、合作确认、进度与交付草稿；新版本重新核对；后台刷新保留已有订单画面；首次读取保持空白；预约补充说明仅同版本原阶段保留；进入沟通清除隐藏旧输入；拒绝/报价/结束沟通/交付确认绑定弹窗时订单版本；更新或离页不提交 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、作者／账号身份、订单事实、状态与进度、合作确认与 NDA、表单字段与校验、图片与附件选择／预览、服务项目选择／编辑、订单通知订阅 |
| 橱窗／作品编辑 · pages/provider-profile/index | provider | 首次引导与管理进度；服务与案例列表及空态；表单与折叠补充项；正文子页；图片管理与水印；独立头图取景；双向关联；完整发布变更与缺项；读取保存失败、冲突及离开选择；独立头图空态与已设置取景；文件工具与单选多选分型；水印同页实时叠加示意，完成时生成一次；作品集母页：80方图、独立图钉置顶及整行编辑热区、置顶排序、真实状态未知时显示已保存、首次添加空态 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、作者／账号身份、服务项目选择／编辑、作品列表卡、作品正文与图集、表单字段与校验、图片与附件选择／预览、城市、日期与档期、金额展示、草稿保存与公开发布阶段 |
| 档期管理（兼容入口） · pages/provider-calendar/index | provider | 真实本人档期独立页面，不再跳转项目Tab；月份切换、暂停接单、日期锁定、版本冲突、保存立即生效；未保存返回确认、离页及账号变化忽略迟到结果 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、城市、日期与档期 |
| 服务方 NDA · pages/provider-task/index | provider | 待对方签署；可签署；已签署；签署完成后继续沟通；确认弹窗绑定原订单版本；过期及离页不提交 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、合作确认与 NDA、订单事实、状态与进度 |
| 订单列表 · pages/orders/index | buyer／provider | 需求方分类；服务方分类；快速切分类丢弃旧请求；离页后不回写列表；账号变化清除旧列表；读取结果及详情入口核对账号；同账号身份分类刷新保留画面；切范围清除旧结果；传输失败保留上次列表并提示重试；明确服务错误清除私有结果 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、订单列表／工作台待办、金额展示 |
| 项目／档期 · pages/projects/index | buyer／provider | 需求方项目列表；服务方日历；同账号版本档期刷新保留草稿；锁定变化重新核对；旧读取不覆盖保存；档期保存/创建项目隐藏或换账号后不回写跳转；返回恢复操作；项目读取失败可重试；隐藏/跨账号/旧请求不覆盖列表；切账号清项目/档期/提示及创建重试键；同账号保留草稿 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、项目资料与订单关联、城市、日期与档期 |
| 项目详情 · pages/project-detail/index | buyer | 成员订单；关联／移除订单；项目资料；目标图片私有链接刷新与不可用状态；归组操作离页不回写；移出确认绑定原项目版本；项目读取期间切账号丢弃原账号返回结果 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、项目资料与订单关联、订单列表／工作台待办、订单事实、状态与进度、图片与附件选择／预览、金额展示 |
| 项目资料编辑 · pages/brief/index | buyer | 草稿；编辑；目标图；目标图片私有链接刷新与不可用状态；保存及城市偏好使用提交快照；离页/换账号不继续同步或返回；图片选择、上传与审核结果核对页面/账号；处理中禁止删除；图片处理与项目保存分别提示；处理中删除入口呈禁用状态；项目读取期间切账号丢弃原账号返回结果 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、项目资料与订单关联、表单字段与校验、图片与附件选择／预览、城市、日期与档期 |
| 交付验收 · pages/fulfillment/index | buyer | 现场服务；文件交付；申请修改；确认验收；图片和PDF预览；ZIP或TXT确认后转发到聊天；已完成订单只读交付内容；微信订阅同意／拒绝／失败；不影响订单操作；验收前明确普通退款关闭／退款争议未结不得验收；后台刷新保留已有订单画面；首次读取保持空白；同版本返回保留未提交修改意见；版本或阶段变化重新核对 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、订单事实、状态与进度、付款、验收与资金记录、表单字段与校验、图片与附件选择／预览、金额展示、订单通知订阅 |
| 订单评价 · pages/review/index | buyer | 不可评价；填写；已评价；评价确认绑定原订单；旧读取不覆盖已评结果；离页后不回写 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、评分、评价与回复、表单字段与校验、订单事实、状态与进度 |
| 服务方订单列表（兼容入口） · pages/provider-orders/index | provider | 分类；查看处理；快速切分类丢弃旧请求；离页后不回写列表；账号变化清除旧列表；读取结果及详情入口核对账号；同账号身份分类刷新保留画面；切范围清除旧结果；传输失败保留上次列表并提示重试；明确服务错误清除私有结果 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、订单列表／工作台待办、金额展示 |
| 服务方评价管理 · pages/provider-reviews/index | provider | 评分概览；评价列表；回复；回复确认核对原评价；旧刷新与离页结果不回写 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、评分、评价与回复、表单字段与校验 |
| 个人中心 · pages/me/index | buyer／provider | 需求方资产；服务方经营；切换身份；当前会话资料先显示／统计随后更新；个人中心失败原身份重试；真实橱窗预览等账号就绪，禁止使用示例ID；切账号/身份先清旧统计；迟到账号结果不回写，预览核对当前账号；已验证同账号最近五分钟缓存先显示，后台刷新；按身份/检索范围隔离；退出清除，不作为交易事实；会话明确草稿版本及公开状态；确认空橱窗不读草稿或公开目录，本人统计与草稿十五分钟复用，保存发布失效；需求方广场偏好入口；2026-10-07个人中心重做：紧凑资料头、合作概况、主要入口、三列收藏、偏好置后；供需共用16px内距/12px组距与细线图标；未知计数不伪造零；需求方昵称下显示用户名；首位喜欢/关注/合作；项目管理后接资金/订单/已完成合作，下方仅广场偏好；服务方保持原布局；双身份镜像：核心数据/项目或橱窗/资金订单合作评价/辅助入口；所有英文账号展示@；合作计数与明细同口径 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、作者／账号身份、关注创作者、喜欢作品、作品列表卡、订单列表／工作台待办、付款、验收与资金记录、金额展示、个人中心与支持内页 |
| 账号资料编辑 · pages/account-profile/index | buyer／provider | 头像；昵称；保存；读取/保存迟到结果不影响已离页或新账号；头像读取/上传/审核跨账号不继续或回写；头像即时本地预览、上传检测与昵称保存分离；有界查询和账号隔离恢复；后端启用后明确提交待检测保存任务 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、作者／账号身份、表单字段与校验、图片与附件选择／预览 |
| 我的内容资产 · pages/me-assets/index | buyer／provider | 关注；喜欢；参考作品；关注/喜欢/参考读取失败原分类重试；重复点击与离页不重新发起；关注/喜欢不读取订单，参考不读取收藏；无关接口失败不阻断列表；关注/喜欢/参考列表确认空时不读公开目录；有条目才加载内容 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、作者／账号身份、关注创作者、喜欢作品、作品列表卡、金额展示 |
| 资金管理 · pages/funds/index | provider | 待开通；付款记录；分页；付款待核对；订单总额／平台服务费／税前预计收益（非可提现余额）；提现指南／未开放；部分退款金额／退款后平台费用／全额退款状态；本人税务资料状态／独立失败重试／未开放隐藏／离页清除；隐藏/离页使资金首屏及分页请求失效；返回重新读取，不接收旧结果；同一资金页按当前身份展示：需求方订单款项→原订单付款/退款；服务方原收益与结算，不混用权限或余额 | 导航与返回、加载／空／错误／成功、主次按钮、固定操作区、付款、验收与资金记录、订单事实、状态与进度、金额展示 |
| 账号说明与规范阅读 · pages/account-notice/index | buyer／provider | 现行v5正文；取消人工入驻要求，须随注册后端版本协调上线；目录跳转；返回保留注册状态 | 导航与返回、作者／账号身份、主次按钮、固定操作区 |
| 广场偏好 · pages/home-preferences/index | buyer | 默认职业；四职业排序；保存/返回/账号变化；账号隔离本地保存、页面重建与冷启动恢复 | 导航与返回、表单字段与校验、主次按钮、固定操作区、搜索、职业和筛选、加载／空／错误／成功 |
| 合作与评价汇总 · pages/me-activity/index | buyer／provider | 加载/空/失败；需求方发起/服务方承接；待办/待评价/已评价；账号变化/返回重读；返回保留进入时身份；同身份内页逐层返回，跨身份不返回旧页面 | 订单列表／工作台待办、作者／账号身份、加载／空／错误／成功、导航与返回、主次按钮、固定操作区、个人中心与支持内页 |
| 帮助与反馈 · pages/help/index | buyer／provider | 双身份指南；8篇帮助正文；真实业务跳转；电话/复制/申请记录入口；返回保留进入时身份；同身份内页逐层返回，跨身份不返回旧页面 | 导航与返回、主次按钮、固定操作区、加载／空／错误／成功、个人中心与支持内页 |
| 设置 · pages/settings/index | buyer／provider | 账号/权限/隐私/关于；原生权限拒绝/失败；明确退出与再次登录；信息查询/更正/注销申请；返回保留进入时身份；同身份内页逐层返回，跨身份不返回旧页面 | 导航与返回、作者／账号身份、主次按钮、固定操作区、加载／空／错误／成功、个人中心与支持内页 |
| 申请与反馈 · pages/support/index | buyer／provider | 表单/本人记录/详情/补充；未确认结果同键重试；版本冲突/关闭/注销撤回；错误/空/分页/账号隔离；最多三张本人审核截图；上传/审核/失败保留；后台返回与账号隔离；补充/撤回未知结果按账号和申请持久化；重进核对；确认弹窗绑定原版本；64px固定缩略图任务行；原生大图预览；审核/拒绝/链接失效保留槽位；返回保留进入时身份；同身份内页逐层返回，跨身份不返回旧页面 | 导航与返回、表单字段与校验、主次按钮、固定操作区、加载／空／错误／成功、个人中心与支持内页、图片与附件选择／预览 |
| 收到的互动 · pages/me-social/index | buyer／provider | 作品获赞/关注我的；公开字段最小展示；分页/空/错误/账号变化；返回保留进入时身份；同身份内页逐层返回，跨身份不返回旧页面 | 导航与返回、喜欢作品、关注创作者、作者／账号身份、主次按钮、固定操作区、加载／空／错误／成功、个人中心与支持内页 |

## 模块反查与当前共享程度

shared=已有共享实现；partial=部分共享；local=页面各自实现。语义相同不代表已技术联动。

### 导航与返回（navigation，shared）

- 使用页：登录／注册、发现／工作台、搜索结果、作品详情、服务者详情、公开档期、发起预约、预约状态、订单详情、退款申请与记录、服务方工作台（兼容入口）、预约与执行处理、橱窗／作品编辑、档期管理（兼容入口）、服务方 NDA、订单列表、项目／档期、项目详情、项目资料编辑、交付验收、订单评价、服务方订单列表（兼容入口）、服务方评价管理、个人中心、账号资料编辑、我的内容资产、资金管理、账号说明与规范阅读、广场偏好、合作与评价汇总、帮助与反馈、设置、申请与反馈、收到的互动
- 共享组件：components/app-top-nav/index、components/main-bottom-nav/index
- 现有逻辑／样式来源：components/app-top-nav/index.js、components/main-bottom-nav/index.js

### 作者／账号身份（identity，partial）

- 使用页：登录／注册、发现／工作台、作品详情、服务者详情、公开档期、发起预约、服务方工作台（兼容入口）、预约与执行处理、橱窗／作品编辑、个人中心、账号资料编辑、我的内容资产、账号说明与规范阅读、合作与评价汇总、设置、收到的互动
- 共享组件：无，待抽取
- 现有逻辑／样式来源：data/v063-store.js、services/cloud-account.js、data/creator-profile.js、templates/creator-profile.wxml、styles/creator-profile.wxss、styles/identity.wxss

### 搜索、职业和筛选（search，partial）

- 使用页：发现／工作台、搜索结果、广场偏好
- 共享组件：无，待抽取
- 现有逻辑／样式来源：utils/discovery-query.js、data/discovery-context.js、data/discovery-controls.js、styles/discovery-controls.wxss、styles/search-dialog.wxss、utils/discovery-pagination.js、templates/discovery-pagination.wxml、utils/display-cache.js、utils/screen-performance.js

### 作品列表卡（work-card，partial）

- 使用页：发现／工作台、搜索结果、服务者详情、橱窗／作品编辑、个人中心、我的内容资产
- 共享组件：components/work-card/index
- 现有逻辑／样式来源：data/catalog.js、templates/creator-content.wxml、styles/creator-profile.wxss

### 作品正文与图集（work-content，local）

- 使用页：作品详情、橱窗／作品编辑
- 共享组件：无，待抽取
- 现有逻辑／样式来源：data/catalog.js、services/cloud-catalog.js

### 关注创作者（follow，partial）

- 使用页：作品详情、服务者详情、个人中心、我的内容资产、收到的互动
- 共享组件：无，待抽取
- 现有逻辑／样式来源：services/cloud-saved-items.js、styles/creator-follow.wxss

### 喜欢作品（like，local）

- 使用页：作品详情、个人中心、我的内容资产、收到的互动
- 共享组件：无，待抽取
- 现有逻辑／样式来源：services/cloud-saved-items.js

### 服务项目选择／编辑（services，local）

- 使用页：发现／工作台、作品详情、服务者详情、发起预约、服务方工作台（兼容入口）、预约与执行处理、橱窗／作品编辑
- 共享组件：无，待抽取
- 现有逻辑／样式来源：services/cloud-catalog.js、templates/creator-content.wxml、styles/creator-profile.wxss

### 城市、日期与档期（calendar，partial）

- 使用页：发现／工作台、服务者详情、公开档期、发起预约、橱窗／作品编辑、档期管理（兼容入口）、项目／档期、项目资料编辑
- 共享组件：components/availability-strip/index
- 现有逻辑／样式来源：styles/availability-calendar.wxss、data/calendar-model.js、services/cloud-availability.js、data/preview-order-slots.js

### 表单字段与校验（form，partial）

- 使用页：登录／注册、发起预约、预约状态、退款申请与记录、预约与执行处理、橱窗／作品编辑、项目资料编辑、交付验收、订单评价、服务方评价管理、账号资料编辑、广场偏好、申请与反馈
- 共享组件：无，待抽取
- 现有逻辑／样式来源：utils/input-normalization.js、styles/fields.wxss、utils/sheet-keyboard.js、styles/sheet-keyboard.wxss、styles/editor-form.wxss、templates/creator-management.wxml、styles/creator-management.wxss、styles/storefront-editor.wxss、data/storefront-changes.js、templates/storefront-guide.wxml、assets/icons/storefront-hint.svg

### 图片与附件选择／预览（media，partial）

- 使用页：作品详情、发起预约、预约状态、订单详情、预约与执行处理、橱窗／作品编辑、项目详情、项目资料编辑、交付验收、账号资料编辑、申请与反馈
- 共享组件：无，待抽取
- 现有逻辑／样式来源：utils/work-media-picker.js、services/cloud-catalog.js、services/cloud-orders.js、utils/order-reference-preview.js、styles/media-placeholder.wxss、utils/work-image-edit.js、utils/banner-crop.js

### 订单列表／工作台待办（order-list，partial）

- 使用页：发现／工作台、服务方工作台（兼容入口）、订单列表、项目详情、服务方订单列表（兼容入口）、个人中心、合作与评价汇总
- 共享组件：无，待抽取
- 现有逻辑／样式来源：styles/order-list.wxss、styles/order-overview.wxss、data/order-presentation.js、templates/provider-workbench.wxml、styles/provider-workbench.wxss

### 订单事实、状态与进度（order-facts，partial）

- 使用页：预约状态、订单详情、退款申请与记录、预约与执行处理、服务方 NDA、项目详情、交付验收、订单评价、资金管理
- 共享组件：无，待抽取
- 现有逻辑／样式来源：styles/order-facts.wxss、data/order-presentation.js、data/order-machine.js、data/booking-status-view.js

### 合作确认与 NDA（agreement，local）

- 使用页：发起预约、预约状态、订单详情、预约与执行处理、服务方 NDA
- 共享组件：无，待抽取
- 现有逻辑／样式来源：services/cloud-orders.js

### 付款、验收与资金记录（payment，local）

- 使用页：预约状态、退款申请与记录、交付验收、个人中心、资金管理
- 共享组件：无，待抽取
- 现有逻辑／样式来源：data/payment-gateway.js、services/cloud-orders.js

### 项目资料与订单关联（project，partial）

- 使用页：订单详情、项目／档期、项目详情、项目资料编辑
- 共享组件：无，待抽取
- 现有逻辑／样式来源：data/project-model.js、services/cloud-projects.js、utils/project-image-preview.js

### 评分、评价与回复（review，partial）

- 使用页：发现／工作台、服务者详情、订单评价、服务方评价管理
- 共享组件：components/rating-stars/index
- 现有逻辑／样式来源：services/cloud-orders.js

### 加载／空／错误／成功（page-state，partial）

- 使用页：登录／注册、发现／工作台、搜索结果、作品详情、服务者详情、公开档期、发起预约、预约状态、订单详情、退款申请与记录、服务方工作台（兼容入口）、预约与执行处理、橱窗／作品编辑、档期管理（兼容入口）、服务方 NDA、订单列表、项目／档期、项目详情、项目资料编辑、交付验收、订单评价、服务方订单列表（兼容入口）、服务方评价管理、个人中心、账号资料编辑、我的内容资产、资金管理、广场偏好、合作与评价汇总、帮助与反馈、设置、申请与反馈、收到的互动
- 共享组件：components/brand-success-card/index、components/first-use-consent/index
- 现有逻辑／样式来源：各页面本地实现

### 主次按钮、固定操作区（actions，partial）

- 使用页：登录／注册、发现／工作台、搜索结果、作品详情、服务者详情、公开档期、发起预约、预约状态、订单详情、退款申请与记录、服务方工作台（兼容入口）、预约与执行处理、橱窗／作品编辑、档期管理（兼容入口）、服务方 NDA、订单列表、项目／档期、项目详情、项目资料编辑、交付验收、订单评价、服务方订单列表（兼容入口）、服务方评价管理、个人中心、账号资料编辑、我的内容资产、资金管理、账号说明与规范阅读、广场偏好、合作与评价汇总、帮助与反馈、设置、申请与反馈、收到的互动
- 共享组件：无，待抽取
- 现有逻辑／样式来源：app.wxss、styles/actions.wxss、utils/order-confirmation.js

### 金额展示（money，shared）

- 使用页：发现／工作台、搜索结果、作品详情、服务者详情、发起预约、预约状态、订单详情、退款申请与记录、橱窗／作品编辑、订单列表、项目详情、交付验收、服务方订单列表（兼容入口）、个人中心、我的内容资产、资金管理
- 共享组件：无，待抽取
- 现有逻辑／样式来源：styles/money.wxss

### 订单通知订阅（order-subscription，shared）

- 使用页：预约状态、订单详情、预约与执行处理、交付验收
- 共享组件：components/order-subscription/index
- 现有逻辑／样式来源：components/order-subscription/index.js、services/order-subscription.js

### 草稿保存与公开发布阶段（publication-stage，shared）

- 使用页：服务者详情、橱窗／作品编辑
- 共享组件：无，待抽取
- 现有逻辑／样式来源：templates/publication-stage.wxml、styles/publication-stage.wxss

### 个人中心与支持内页（personal-center，partial）

- 使用页：个人中心、合作与评价汇总、帮助与反馈、设置、申请与反馈、收到的互动
- 共享组件：无，待抽取
- 现有逻辑／样式来源：styles/me-interiors.wxss、data/me-activity.js、data/help-content.js

## 页面交互入口（源码提取）

- **登录／注册**：authorizeRegistrationPhone、checkSession、chooseMethod、requestSmsCode、showNotice、showPrivacy、submitLogin、submitRegister、submitSms、switchMode、toggleNotice、updateNickname、updatePhone、updateUsername、updateVerificationCode
- **发现／工作台**：applyFilters、chooseCareer、chooseMode、clearRecent、closeFilters、closeSearch、completeFirstUse、loadMoreCatalog、noop、onNavigationLayout、openFilters、openFlow、openPriority、openProviderCalendar、openProviderOrders、openProviderProfile、openProviderReviews、openProviderWork、openSearch、removeRecent、resetFilters、retryDashboard、showProvider、submitSearch、toggleFilter、updateCity、updateDate、updateSearchDraft
- **搜索结果**：clearRecent、closeSearch、loadMoreCatalog、noop、onNavigationLayout、openSearch、removeRecent、submitSearch、updateSearchDraft
- **作品详情**：copyCode、openProvider、openRelatedService、previewGallery、retryLoad、retrySocial、startBooking、toggleFollow、toggleLike
- **服务者详情**：backStorefrontPage、cancelPublication、changeStorefrontMonth、chooseProfileTab、continueEditing、editStorefront、loadStorefrontCalendar、openOwnerCalendar、openReviews、openServiceDetail、openWork、queryOriginalPublication、retryLoad、retrySocial、returnToStorefrontManager、showPublishedStorefront、startBooking、toggleFollow、togglePreferences、toggleService、toggleServiceInfo
- **公开档期**：changePreviewMonth、chooseDate、retryLoad、returnToPreview、startBooking
- **发起预约**：addSegment、cancelEditor、changeNda、chooseReference、chooseReferenceFile、chooseTimeMode、clearReference、openEditor、preventSheetBackgroundScroll、removeSegment、retryLoad、saveEditor、sheetInputFocus、sheetKeyboardChange、submitBooking、toggleService、updateCity、updateContact、updateDate、updateEndDate、updateEndTime、updateNote、updateSegment、updateStartDate、updateStartTime
- **预约状态**：closePanel、confirmReviewed、copyCode、goMarket、goOrder、openPanel、openReference、preventSheetBackgroundScroll、refreshStatus、retryBooking、retryLoad、sheetInputFocus、sheetKeyboardChange、signNda、startPayment、stopTap、submitSupplement、toggleDetails、updateAgreementRead、updateSupplement、viewProvider
- **订单详情**：confirmExecution、goBookingStatus、goDelivery、goProject、goRefund、goReview、openReference、retryLoad、signNda
- **退款申请与记录**：inputAmount、inputReason、load、moreRecords、refreshRecords、startNext、submit
- **服务方工作台（兼容入口）**：openFlow、openPriority、openProviderCalendar、openProviderOrders、openProviderProfile、openProviderReviews、openProviderWork、retryDashboard
- **预约与执行处理**：callBuyer、chooseDeliveryFiles、chooseNda、commitProgress、copyContact、decline、failCommunication、finishCommunication、goNda、goRefund、interested、openReference、retryLoad、savePrice、saveProgress、submitDelivery、supplement、toggleConfirm、updateDelivery、updateNote、updateQuoteItem
- **橱窗／作品编辑**：addService、addServiceArea、applyWatermark、changeEditorKeyboard、chooseBanner、chooseNoticeImage、chooseWorkImages、closeBannerEditor、confirmWorkPicker、confirmWorkService、continueSavedSection、continueWorkEditing、createAssociatedService、deleteService、editReviewChange、finishSavedSection、finishTextEditor、fixPublicationIssue、focusEditorField、loadPublicationReview、manageSavedWork、navigateEditorBack、openAccount、openBannerEditor、openCalendar、openNewWorkEditor、openPublicationCheck、openPublicationProgress、openSection、openSetupStep、openTextEditor、openWorkEditor、openWorkPicker、previewBuyer、previewOriginalImage、removeCasePendingImage、removeNoticeImage、removeServiceArea、requestRemoveBanner、requestRemoveWorkImage、retryCloudLoad、retryWorkImages、saveAndPreview、saveSection、saveWork、selectCaseWatermark、selectWorkService、submitPublication、toggleOptional、togglePortfolioPin、toggleServiceEditor、toggleWorkPickerWork、updateBannerFocus、updateCareer、updateEditorText、updateProfile、updateProfileRegion、updateService、updateServiceMode、updateWatermark、updateWork
- **档期管理（兼容入口）**：back、changeAccepting、changeMonth、load、reset、save、toggle
- **服务方 NDA**：continueCommunication、retryLoad、sign
- **订单列表**：choose、open、retryLoad
- **项目／档期**：createProject、loadProjects、openProject、reset、save、toggle
- **项目详情**：addOrder、linkOrder、openBrief、openOrder、previewTargetImage、retryLoad、unlinkOrder
- **项目资料编辑**：chooseTargetImages、previewTargetImage、removeTargetImage、retryLoad、save、updateCity、updateDate、updateDescription、updateLocation、updateProjectName
- **交付验收**：accept、goOrders、goReview、openDeliveryFile、retryLoad、revise、updateRevision
- **订单评价**：chooseRating、goOrders、retryLoad、submit、updateText
- **服务方订单列表（兼容入口）**：choose、open、retryLoad
- **服务方评价管理**：reply、retryLoad、toggleReply、update
- **个人中心**：editAccount、openActivity、openAssets、openBusiness、openBuyerOrders、openCalendar、openFunds、openHelp、openHighlight、openHomePreferences、openRecentProject、openReviews、openSettings、openTodo、previewStorefront、retryDashboard、switchIdentity
- **账号资料编辑**：back、chooseAvatar、save、updateNickname
- **我的内容资产**：openItem、retryLoad
- **资金管理**：load、loadMore、loadTaxStatus、openOrder、showWithdrawalGuide
- **账号说明与规范阅读**：goBack、jumpToSection
- **广场偏好**：makeFirst、move、save
- **合作与评价汇总**：filter、open、openOrders、refresh
- **帮助与反馈**：call、contact、copy、feedback、history、openArticle、openRelated
- **设置**：agreement、contact、edit、loadAccount、logout、open、openPermission、privacy、request、subscribe
- **申请与反馈**：append、chooseImages、contact、history、imageUnavailable、input、load、open、previewDraft、previewImage、refreshImages、removeImage、retryMutation、submit
- **收到的互动**：load、openWork

## 现有样式债务

扫描 64 份 WXSS；以下是当前源码字面量，不是推荐规范。

- font-size：13 种；0、16rpx、25rpx、27rpx、29rpx、30rpx、34rpx、36rpx、38rpx、40rpx、42rpx、48rpx、72rpx
- font-weight：1 种；300
- line-height：27 种；1、1.25、1.4、1.5、1.6、1.65、1.7、24rpx、28rpx、30rpx、32rpx、34rpx、35rpx、37rpx、38rpx、42rpx、46rpx、48rpx、50rpx、52rpx、54rpx、58rpx、62rpx、64rpx、72rpx、88rpx、normal
- gap：13 种；0 12rpx、10rpx、10rpx 20rpx、12rpx、12rpx 0、14rpx、18rpx、20rpx、22rpx、26rpx、2rpx、4rpx、6rpx
- border-radius：20 种；0、0 0 36rpx 36rpx、10rpx、16rpx、18rpx、20rpx、22rpx、24rpx、26rpx、28rpx、30rpx、34rpx、36rpx、38rpx、3rpx、4rpx、50%、6rpx、8rpx、999rpx
