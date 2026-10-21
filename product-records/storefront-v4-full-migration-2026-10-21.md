# 累计 V4 全层级迁移清单（0.9.24 修正）

原 84 项全部列出，不能把最后一次样式调整当成全部需求。以下是源码落点清单，不是 84 项原生验收通过声明。

基准：V4 修订＋R2 表情＋14项设计规则修正＋跨页尺度及后端方案。头像选择/取景和原图/图集复用微信原生能力；保留真实服务方式、字段限制、订单语义。

| 原标识 | 原页面/状态 | 小程序落点 | 核验边界 |
|---|---|---|---|
| manager | 管理橱窗 | provider-profile：管理页、三步任务、公开主页入口、发布状态；无变更在发布确认页判断 | 源码已对应；真实会话原生/真机交互待验 |
| works | 作品集 | provider-profile：managementTab 列表、空态、删除确认和下一步入口 | 源码已对应；真实会话原生/真机交互待验 |
| work | 编辑作品 | provider-profile：案例主表单、补充项折叠、正文子页及原列表返回 | 源码已对应；真实会话原生/真机交互待验 |
| services | 服务项目 | provider-profile：managementTab 列表、空态、删除确认和下一步入口 | 源码已对应；真实会话原生/真机交互待验 |
| service | 编辑服务 | provider-profile：服务表单、原地选择、合作细节折叠、正文子页 | 源码已对应；真实会话原生/真机交互待验 |
| profile | 橱窗资料 | provider-profile：资料表单、短字段原地、简介子页和偏好折叠 | 源码已对应；真实会话原生/真机交互待验 |
| banner | 主页头图 | provider-profile：独立头图子页、16:9取景、原图保留、移除确认 | 源码已对应；真实会话原生/真机交互待验 |
| account | 头像与昵称 | account-profile：微信 chooseAvatar 原生头像选择/取景、独立保存、检测反馈及失败恢复 | 源码已对应；真实会话原生/真机交互待验 |
| images | 管理图片 | provider-profile：独立图片管理、前后移动、展开工具、原图和失败重试 | 源码已对应；真实会话原生/真机交互待验 |
| watermark | 图片水印 | provider-profile：imageSettings 同页设置、预览、原图保留和完成返回 | 源码已对应；真实会话原生/真机交互待验 |
| association | 作品选择关联服务 | provider-profile：双向关联、可不关联、新建服务回到原案例 | 源码已对应；真实会话原生/真机交互待验 |
| tags | 作品标签 | provider-profile：案例主表单、补充项折叠、正文子页及原列表返回 | 源码已对应；真实会话原生/真机交互待验 |
| credits | 创作人员 | provider-profile：案例主表单、补充项折叠、正文子页及原列表返回 | 源码已对应；真实会话原生/真机交互待验 |
| notice | 接单须知 | provider-profile：须知正文子页、配图折叠、选择/替换/移除/失败提示 | 源码已对应；真实会话原生/真机交互待验 |
| calendar | 档期与接单状态 | provider-calendar：真实独立档期、接单开关、锁定、保存结果和失败保留 | 源码已对应；真实会话原生/真机交互待验 |
| preview | 创作者主页预览 | provider-detail：保存快照预览、公开版本、独立头图、四个内容页签 | 源码已对应；真实会话原生/真机交互待验 |
| review | 本次更新预览 | provider-profile：发布确认，新增/修改/移除对照、缺项定位、只读预览 | 源码已对应；真实会话原生/真机交互待验 |
| workpreview | 作品详情预览 | work-detail：本人案例阅读页及微信原生图集 | 源码已对应；真实会话原生/真机交互待验 |
| servicepreview | 服务详情预览 | provider-detail：serviceDetail 阅读子视图和关联案例 | 源码已对应；真实会话原生/真机交互待验 |
| noticepreview | 须知预览 | provider-detail：须知页签、偏好展开、评价弹层 | 源码已对应；真实会话原生/真机交互待验 |
| result | 发布结果 | provider-detail：独立发布结果、检测进度、失败/未知、原任务查询及撤回 | 源码已对应；真实会话原生/真机交互待验 |
| empty | 首次空橱窗 | provider-profile：管理页、三步任务、公开主页入口、发布状态；无变更在发布确认页判断 | 源码已对应；真实会话原生/真机交互待验 |
| error | 检测未通过 | provider-detail：独立发布结果、检测进度、失败/未知、原任务查询及撤回 | 源码已对应；真实会话原生/真机交互待验 |
| unavailable | 发布暂不可用 | provider-detail：独立发布结果、检测进度、失败/未知、原任务查询及撤回 | 源码已对应；真实会话原生/真机交互待验 |
| mode | 服务方式 | provider-profile：服务表单、原地选择、合作细节折叠、正文子页 | 源码已对应；真实会话原生/真机交互待验 |
| city | 服务城市 | provider-profile：服务表单、原地选择、合作细节折叠、正文子页 | 源码已对应；真实会话原生/真机交互待验 |
| schedulepreview | 档期预览 | provider-schedule：本人真实月历预览、月份切换、无预约提交 | 源码已对应；真实会话原生/真机交互待验 |
| bio | 个人简介 | provider-profile：资料表单、短字段原地、简介子页和偏好折叠 | 源码已对应；真实会话原生/真机交互待验 |
| profiletags | 主页标签 | provider-profile：资料表单、短字段原地、简介子页和偏好折叠 | 源码已对应；真实会话原生/真机交互待验 |
| specialties | 擅长类型 | provider-profile：资料表单、短字段原地、简介子页和偏好折叠 | 源码已对应；真实会话原生/真机交互待验 |
| declines | 不承接类型 | provider-profile：资料表单、短字段原地、简介子页和偏好折叠 | 源码已对应；真实会话原生/真机交互待验 |
| hours | 通常沟通时间 | provider-profile：资料表单、短字段原地、简介子页和偏好折叠 | 源码已对应；真实会话原生/真机交互待验 |
| career | 服务职业 | provider-profile：资料表单、短字段原地、简介子页和偏好折叠 | 源码已对应；真实会话原生/真机交互待验 |
| resident | 常驻城市 | provider-profile：资料表单、短字段原地、简介子页和偏好折叠 | 源码已对应；真实会话原生/真机交互待验 |
| bannercrop | 裁切主页头图 | provider-profile：独立头图子页、16:9取景、原图保留、移除确认 | 源码已对应；真实会话原生/真机交互待验 |
| bannerready | 已设置的主页头图 | provider-profile：独立头图子页、16:9取景、原图保留、移除确认 | 源码已对应；真实会话原生/真机交互待验 |
| removebanner | 移除头图确认 | provider-profile：独立头图子页、16:9取景、原图保留、移除确认 | 源码已对应；真实会话原生/真机交互待验 |
| avatarcrop | 裁切头像 | account-profile：微信 chooseAvatar 原生头像选择/取景、独立保存、检测反馈及失败恢复 | 源码已对应；真实会话原生/真机交互待验 |
| accountpending | 账号资料处理中 | account-profile：微信 chooseAvatar 原生头像选择/取景、独立保存、检测反馈及失败恢复 | 源码已对应；真实会话原生/真机交互待验 |
| accountfailed | 头像未通过 | account-profile：微信 chooseAvatar 原生头像选择/取景、独立保存、检测反馈及失败恢复 | 源码已对应；真实会话原生/真机交互待验 |
| workbody | 作品正文 | provider-profile：案例主表单、补充项折叠、正文子页及原列表返回 | 源码已对应；真实会话原生/真机交互待验 |
| imagesettings | 第 2 张图片 | provider-profile：独立图片管理、前后移动、展开工具、原图和失败重试 | 源码已对应；真实会话原生/真机交互待验 |
| reorder | 调整图片顺序 | provider-profile：独立图片管理、前后移动、展开工具、原图和失败重试 | 源码已对应；真实会话原生/真机交互待验 |
| watermarkposition | 水印位置 | provider-profile：imageSettings 同页设置、预览、原图保留和完成返回 | 源码已对应；真实会话原生/真机交互待验 |
| original | 原图查看 | provider-profile：独立图片管理、前后移动、展开工具、原图和失败重试 | 源码已对应；真实会话原生/真机交互待验 |
| removeimage | 移除图片确认 | provider-profile：独立图片管理、前后移动、展开工具、原图和失败重试 | 源码已对应；真实会话原生/真机交互待验 |
| uploading | 图片上传中 | provider-profile：独立图片管理、前后移动、展开工具、原图和失败重试 | 源码已对应；真实会话原生/真机交互待验 |
| uploadfailed | 部分图片上传失败 | provider-profile：独立图片管理、前后移动、展开工具、原图和失败重试 | 源码已对应；真实会话原生/真机交互待验 |
| associatedworks | 服务选择关联作品 | provider-profile：双向关联、可不关联、新建服务回到原案例 | 源码已对应；真实会话原生/真机交互待验 |
| unit | 计价单位 | provider-profile：服务表单、原地选择、合作细节折叠、正文子页 | 源码已对应；真实会话原生/真机交互待验 |
| citypicker | 添加服务城市 | provider-profile：服务表单、原地选择、合作细节折叠、正文子页 | 源码已对应；真实会话原生/真机交互待验 |
| description | 详细描述 | provider-profile：服务表单、原地选择、合作细节折叠、正文子页 | 源码已对应；真实会话原生/真机交互待验 |
| includes | 包含 / 不包含内容 | provider-profile：服务表单、原地选择、合作细节折叠、正文子页 | 源码已对应；真实会话原生/真机交互待验 |
| extras | 额外费用说明 | provider-profile：服务表单、原地选择、合作细节折叠、正文子页 | 源码已对应；真实会话原生/真机交互待验 |
| preparation | 预约前准备 | provider-profile：服务表单、原地选择、合作细节折叠、正文子页 | 源码已对应；真实会话原生/真机交互待验 |
| deleteservice | 删除服务确认 · 多服务时 | provider-profile：managementTab 列表、空态、删除确认和下一步入口 | 源码已对应；真实会话原生/真机交互待验 |
| pin | 置顶作品 | provider-profile：案例主表单、补充项折叠、正文子页及原列表返回 | 源码已对应；真实会话原生/真机交互待验 |
| newwork | 添加作品 | provider-profile：案例主表单、补充项折叠、正文子页及原列表返回 | 源码已对应；真实会话原生/真机交互待验 |
| newservice | 添加服务 | provider-profile：服务表单、原地选择、合作细节折叠、正文子页 | 源码已对应；真实会话原生/真机交互待验 |
| works-empty | 作品集 · 空 | provider-profile：managementTab 列表、空态、删除确认和下一步入口 | 源码已对应；真实会话原生/真机交互待验 |
| services-empty | 服务项目 · 空 | provider-profile：managementTab 列表、空态、删除确认和下一步入口 | 源码已对应；真实会话原生/真机交互待验 |
| noticetext | 合作须知 | provider-profile：须知正文子页、配图折叠、选择/替换/移除/失败提示 | 源码已对应；真实会话原生/真机交互待验 |
| noticeimage | 须知配图 | provider-profile：须知正文子页、配图折叠、选择/替换/移除/失败提示 | 源码已对应；真实会话原生/真机交互待验 |
| noticeupload | 须知配图上传失败 | provider-profile：须知正文子页、配图折叠、选择/替换/移除/失败提示 | 源码已对应；真实会话原生/真机交互待验 |
| calendarsaved | 档期保存成功 | provider-calendar：真实独立档期、接单开关、锁定、保存结果和失败保留 | 源码已对应；真实会话原生/真机交互待验 |
| accepting | 接单状态 | provider-calendar：真实独立档期、接单开关、锁定、保存结果和失败保留 | 源码已对应；真实会话原生/真机交互待验 |
| calendarerror | 档期读取失败 | provider-calendar：真实独立档期、接单开关、锁定、保存结果和失败保留 | 源码已对应；真实会话原生/真机交互待验 |
| preferences | 合作偏好 | provider-detail：须知页签、偏好展开、评价弹层 | 源码已对应；真实会话原生/真机交互待验 |
| reviews | 合作评价 | provider-detail：须知页签、偏好展开、评价弹层 | 源码已对应；真实会话原生/真机交互待验 |
| workgallery | 作品图集 | work-detail：本人案例阅读页及微信原生图集 | 源码已对应；真实会话原生/真机交互待验 |
| previewbanner | 主页预览 · 已设头图 | provider-detail：保存快照预览、公开版本、独立头图、四个内容页签 | 源码已对应；真实会话原生/真机交互待验 |
| previewempty | 主页预览 · 无作品 | provider-detail：保存快照预览、公开版本、独立头图、四个内容页签 | 源码已对应；真实会话原生/真机交互待验 |
| incomplete | 发布内容待完善 | provider-profile：发布确认，新增/修改/移除对照、缺项定位、只读预览 | 源码已对应；真实会话原生/真机交互待验 |
| submitting | 正在提交发布 | provider-detail：独立发布结果、检测进度、失败/未知、原任务查询及撤回 | 源码已对应；真实会话原生/真机交互待验 |
| published | 已发布 | provider-detail：独立发布结果、检测进度、失败/未知、原任务查询及撤回 | 源码已对应；真实会话原生/真机交互待验 |
| publicpreview | 本人公开主页 | provider-detail：保存快照预览、公开版本、独立头图、四个内容页签 | 源码已对应；真实会话原生/真机交互待验 |
| unknown | 发布结果待确认 | provider-detail：独立发布结果、检测进度、失败/未知、原任务查询及撤回 | 源码已对应；真实会话原生/真机交互待验 |
| unchanged | 管理橱窗 · 无新修改 | provider-profile：管理页、三步任务、公开主页入口、发布状态；无变更在发布确认页判断 | 源码已对应；真实会话原生/真机交互待验 |
| loading | 橱窗读取中 | provider-profile：读取状态、版本冲突保留、保存/继续/放弃选择及先撤回再编辑 | 源码已对应；真实会话原生/真机交互待验 |
| loadfailed | 橱窗读取失败 | provider-profile：读取状态、版本冲突保留、保存/继续/放弃选择及先撤回再编辑 | 源码已对应；真实会话原生/真机交互待验 |
| savefailed | 作品保存失败 | provider-profile：案例主表单、补充项折叠、正文子页及原列表返回 | 源码已对应；真实会话原生/真机交互待验 |
| unsaved | 未保存返回确认 | provider-profile：读取状态、版本冲突保留、保存/继续/放弃选择及先撤回再编辑 | 源码已对应；真实会话原生/真机交互待验 |
| conflict | 草稿版本已更新 | provider-profile：读取状态、版本冲突保留、保存/继续/放弃选择及先撤回再编辑 | 源码已对应；真实会话原生/真机交互待验 |
| pendingedit | 检测中继续编辑 | provider-profile：读取状态、版本冲突保留、保存/继续/放弃选择及先撤回再编辑 | 源码已对应；真实会话原生/真机交互待验 |

## 证据与限制

- 自动回归见 `.artifacts/storefront-v4-full-migration/frontend-tests.txt`、`backend-tests.txt`；覆盖保存/预览分离、草稿版本、关联返回、检测、身份隔离、缓存、图片编辑及档期。
- WXML/WXSS 浏览器映射只用于全画面布局检查，不能代替原生组件、键盘、安全区和真实上传耗时。
- 独立头图新增 JSON 字段与发布前对照读取接口；沿用已部署 0056/0057，未新增迁移或清空数据。
- 正式上线白名单、真实新手测试和实际/体感耗时验收仍按原上线待办推进。
