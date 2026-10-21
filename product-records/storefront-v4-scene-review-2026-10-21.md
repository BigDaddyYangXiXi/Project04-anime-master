> 后续修正已本地实施，逐项处理见 [本地修正记录](storefront-v4-corrections-2026-10-21.md)。下表保留审查时的问题证据；“原生验收未完成”仍有效，不因实现或编译通过改为已验收。

# 61个V4页面/状态逐项校对台账

2026-10-21。逐项核对原稿渲染函数、当前WXML/WXSS分支；静态可确认的差异见编号报告，交互状态仍须实际执行。不存在“原生已通过”项。

依据：后续跨页尺度方案优先于旧V4截图；旧84项已合并到此61场景。编号详见 [逐页审查](storefront-v4-page-by-page-review-2026-10-21.md)。

| 序号 | 分组 | 设计场景 | 当前对应 | 校对结果/差异 | 原生验收 |
|---|---|---|---|---|---|
| 1 | 首用与管理 | [首次空橱窗](http://127.0.0.1:4321/?fixture=first) `first` | templates/creator-management.wxml | 存在差异或缺项，见 R02（R02） | 未完成 |
| 2 | 首用与管理 | [有草稿的管理页](http://127.0.0.1:4321/?fixture=manager) `manager` | templates/creator-management.wxml | 存在差异或缺项，见 R02（R02） | 未完成 |
| 3 | 首用与管理 | [服务列表与下一步](http://127.0.0.1:4321/?fixture=services) `services` | provider-profile：managementTab=services | 存在差异或缺项，见 R03（R03） | 未完成 |
| 4 | 首用与管理 | [案例列表与置顶](http://127.0.0.1:4321/?fixture=works) `works` | provider-profile：managementTab=works/services、editor-empty | 存在差异或缺项，见 R04（R04） | 未完成 |
| 5 | 首用与管理 | [服务列表空态](http://127.0.0.1:4321/?fixture=empty-services) `empty-services` | provider-profile：managementTab=works/services、editor-empty | 存在差异或缺项，见 R04（R04） | 未完成 |
| 6 | 首用与管理 | [案例列表空态](http://127.0.0.1:4321/?fixture=empty-works) `empty-works` | provider-profile：managementTab=works/services、editor-empty | 存在差异或缺项，见 R04（R04） | 未完成 |
| 7 | 首用与管理 | [公开且没有新修改](http://127.0.0.1:4321/?fixture=nochange) `nochange` | templates/creator-management.wxml | 存在差异或缺项，见 R02（R02） | 未完成 |
| 8 | 服务与关联 | [添加服务](http://127.0.0.1:4321/?fixture=new-service) `new-service` | provider-profile：editorView=service | 存在差异或缺项，见 R05（R05） | 未完成 |
| 9 | 服务与关联 | [编辑服务及全部选填项](http://127.0.0.1:4321/?fixture=edit-service) `edit-service` | provider-profile：editorView=service | 存在差异或缺项，见 R05（R05） | 未完成 |
| 10 | 服务与关联 | [服务介绍编辑](http://127.0.0.1:4321/?fixture=service-text) `service-text` | provider-profile：textEditor | 存在差异或缺项，见 R06（R06） | 未完成 |
| 11 | 服务与关联 | [服务选择案例](http://127.0.0.1:4321/?fixture=associatedworks) `associatedworks` | provider-profile：workPickerOpen | 存在差异或缺项，见 R08（R08） | 未完成 |
| 12 | 服务与关联 | [没有可选案例](http://127.0.0.1:4321/?fixture=no-associatedworks) `no-associatedworks` | provider-profile：workPickerOpen | 存在差异或缺项，见 R08（R08） | 未完成 |
| 13 | 服务与关联 | [删除服务确认](http://127.0.0.1:4321/?fixture=delete-service) `delete-service` | provider-profile及关联页的modal/actionSheet/error/leave处理 | 已核对静态调用；运行状态待实测（R27） | 未完成 |
| 14 | 案例与图片 | [添加妆造案例](http://127.0.0.1:4321/?fixture=new-work) `new-work` | provider-profile：editorSection=works | 存在差异或缺项，见 R09、R10（R09、R10） | 未完成 |
| 15 | 案例与图片 | [案例编辑及全部选填项](http://127.0.0.1:4321/?fixture=edit-work) `edit-work` | provider-profile：editorSection=works | 存在差异或缺项，见 R09、R10（R09、R10） | 未完成 |
| 16 | 案例与图片 | [案例介绍编辑](http://127.0.0.1:4321/?fixture=work-text) `work-text` | provider-profile：textEditor | 存在差异或缺项，见 R06（R06） | 未完成 |
| 17 | 案例与图片 | [案例选择服务](http://127.0.0.1:4321/?fixture=association) `association` | provider-profile：workServicePickerOpen | 存在差异或缺项，见 R07（R07） | 未完成 |
| 18 | 案例与图片 | [尚无服务时创建并返回](http://127.0.0.1:4321/?fixture=no-association) `no-association` | provider-profile：workServicePickerOpen | 存在差异或缺项，见 R07（R07） | 未完成 |
| 19 | 案例与图片 | [图片管理与排序](http://127.0.0.1:4321/?fixture=images) `images` | provider-profile：imagesEditorOpen | 存在差异或缺项，见 R11（R11） | 未完成 |
| 20 | 案例与图片 | [合并后的完整水印设置](http://127.0.0.1:4321/?fixture=watermark) `watermark` | provider-profile：imageSettings | 存在差异或缺项，见 R12（R12） | 未完成 |
| 21 | 案例与图片 | [移除图片确认](http://127.0.0.1:4321/?fixture=remove-image) `remove-image` | provider-profile及关联页的modal/actionSheet/error/leave处理 | 已核对静态调用；运行状态待实测（R27） | 未完成 |
| 22 | 案例与图片 | [上传失败保留原内容](http://127.0.0.1:4321/?fixture=upload-failure) `upload-failure` | provider-profile：imagesEditorOpen | 存在差异或缺项，见 R11（R11） | 未完成 |
| 23 | 资料与须知 | [资料与短字段原地填写](http://127.0.0.1:4321/?fixture=profile) `profile` | provider-profile：editorView=profile | 存在差异或缺项，见 R13（R13） | 未完成 |
| 24 | 资料与须知 | [独立头图未设置](http://127.0.0.1:4321/?fixture=banner) `banner` | provider-profile：bannerEditorOpen | 存在差异或缺项，见 R14（R14） | 未完成 |
| 25 | 资料与须知 | [用户已指定头图](http://127.0.0.1:4321/?fixture=banner-set) `banner-set` | provider-profile：bannerEditorOpen | 存在差异或缺项，见 R14（R14） | 未完成 |
| 26 | 资料与须知 | [账号资料独立保存](http://127.0.0.1:4321/?fixture=account) `account` | account-profile | 存在差异或缺项，见 R15（R15） | 未完成 |
| 27 | 资料与须知 | [新头像检测中](http://127.0.0.1:4321/?fixture=avatar-pending) `avatar-pending` | account-profile | 存在差异或缺项，见 R15（R15） | 未完成 |
| 28 | 资料与须知 | [头像未通过，保留旧头像](http://127.0.0.1:4321/?fixture=avatar-rejected) `avatar-rejected` | account-profile | 存在差异或缺项，见 R15（R15） | 未完成 |
| 29 | 资料与须知 | [头像取景直接调整](http://127.0.0.1:4321/?fixture=avatar-crop) `avatar-crop` | account-profile | 平台适配/同数据对照待验证（R15） | 未完成 |
| 30 | 资料与须知 | [合作须知与配图](http://127.0.0.1:4321/?fixture=notice) `notice` | provider-profile：editorView=notice | 存在差异或缺项，见 R16（R16） | 未完成 |
| 31 | 档期与接单 | [公开档期与接单状态](http://127.0.0.1:4321/?fixture=calendar) `calendar` | provider-calendar | 存在差异或缺项，见 R17（R17） | 未完成 |
| 32 | 档期与接单 | [暂停接单的含义](http://127.0.0.1:4321/?fixture=paused) `paused` | provider-calendar | 存在差异或缺项，见 R17（R17） | 未完成 |
| 33 | 档期与接单 | [订单锁定日期不可修改](http://127.0.0.1:4321/?fixture=locked) `locked` | provider-calendar | 存在差异或缺项，见 R17（R17） | 未完成 |
| 34 | 预览与下钻 | [草稿主页预览](http://127.0.0.1:4321/?fixture=preview) `preview` | provider-detail：storefrontDraftPreview/providerPreview | 平台适配/同数据对照待验证（R18） | 未完成 |
| 35 | 预览与下钻 | [明确设置头图后的预览](http://127.0.0.1:4321/?fixture=preview-banner) `preview-banner` | provider-detail：storefrontDraftPreview/providerPreview | 存在差异或缺项，见 R18（R18） | 未完成 |
| 36 | 预览与下钻 | [没有案例时的预览](http://127.0.0.1:4321/?fixture=preview-empty) `preview-empty` | provider-detail：storefrontDraftPreview/providerPreview | 存在差异或缺项，见 R18（R18） | 未完成 |
| 37 | 预览与下钻 | [公开主页版本](http://127.0.0.1:4321/?fixture=public-preview) `public-preview` | provider-detail：storefrontDraftPreview/providerPreview | 平台适配/同数据对照待验证（R18） | 未完成 |
| 38 | 预览与下钻 | [案例详情与价格含义](http://127.0.0.1:4321/?fixture=work-preview) `work-preview` | work-detail：providerPreview、wx.previewImage | 存在差异或缺项，见 R22（R22） | 未完成 |
| 39 | 预览与下钻 | [服务详情与关联案例](http://127.0.0.1:4321/?fixture=service-preview) `service-preview` | provider-detail：serviceDetail | 存在差异或缺项，见 R21（R21） | 未完成 |
| 40 | 预览与下钻 | [原比例图集](http://127.0.0.1:4321/?fixture=gallery) `gallery` | work-detail：providerPreview、wx.previewImage | 平台适配/同数据对照待验证（R22） | 未完成 |
| 41 | 预览与下钻 | [合作须知阅读](http://127.0.0.1:4321/?fixture=notice-preview) `notice-preview` | provider-detail：profileTab=notice | 存在差异或缺项，见 R16、R18（R16、R18） | 未完成 |
| 42 | 预览与下钻 | [合作偏好阅读](http://127.0.0.1:4321/?fixture=preferences) `preferences` | provider-detail：preferencesOpen/reviewsOpen | 存在差异或缺项，见 R20（R20） | 未完成 |
| 43 | 预览与下钻 | [评价空态](http://127.0.0.1:4321/?fixture=reviews) `reviews` | provider-detail：preferencesOpen/reviewsOpen | 存在差异或缺项，见 R20（R20） | 未完成 |
| 44 | 预览与下钻 | [公开档期只读](http://127.0.0.1:4321/?fixture=schedule-preview) `schedule-preview` | provider-detail：profileTab=schedule；provider-schedule | 存在差异或缺项，见 R19（R19） | 未完成 |
| 45 | 发布与恢复 | [发布前确认完整变更](http://127.0.0.1:4321/?fixture=review) `review` | provider-profile：managementTab=check | 存在差异或缺项，见 R23（R23） | 未完成 |
| 46 | 发布与恢复 | [新增、修改与移除明细](http://127.0.0.1:4321/?fixture=review-mixed) `review-mixed` | provider-profile：managementTab=check | 存在差异或缺项，见 R23（R23） | 未完成 |
| 47 | 发布与恢复 | [必要信息缺项定位](http://127.0.0.1:4321/?fixture=missing) `missing` | provider-profile：managementTab=check | 存在差异或缺项，见 R23（R23） | 未完成 |
| 48 | 发布与恢复 | [提交尚未确认](http://127.0.0.1:4321/?fixture=submitting) `submitting` | provider-detail：publicationFlow | 存在差异或缺项，见 R24（R24） | 未完成 |
| 49 | 发布与恢复 | [检测中尚未公开](http://127.0.0.1:4321/?fixture=pending) `pending` | provider-detail：publicationFlow | 存在差异或缺项，见 R24（R24） | 未完成 |
| 50 | 发布与恢复 | [检测中返回管理](http://127.0.0.1:4321/?fixture=pending-manager) `pending-manager` | templates/creator-management.wxml | 存在差异或缺项，见 R02（R02） | 未完成 |
| 51 | 发布与恢复 | [已公开后检查接单状态](http://127.0.0.1:4321/?fixture=published) `published` | provider-detail：previewPublished | 存在差异或缺项，见 R25（R25） | 未完成 |
| 52 | 发布与恢复 | [内容未通过](http://127.0.0.1:4321/?fixture=rejected) `rejected` | provider-detail：publishError/publicationUnknown | 存在差异或缺项，见 R26（R26） | 未完成 |
| 53 | 发布与恢复 | [未知结果查询原任务](http://127.0.0.1:4321/?fixture=unknown) `unknown` | provider-detail：publishError/publicationUnknown | 存在差异或缺项，见 R26（R26） | 未完成 |
| 54 | 发布与恢复 | [保存失败保留输入](http://127.0.0.1:4321/?fixture=save-failure) `save-failure` | provider-profile及关联页的modal/actionSheet/error/leave处理 | 已核对静态调用；运行状态待实测（R27） | 未完成 |
| 55 | 发布与恢复 | [未保存返回确认](http://127.0.0.1:4321/?fixture=unsaved) `unsaved` | provider-profile及关联页的modal/actionSheet/error/leave处理 | 已核对静态调用；运行状态待实测（R27） | 未完成 |
| 56 | 发布与恢复 | [子页取消编辑确认](http://127.0.0.1:4321/?fixture=child-unsaved) `child-unsaved` | provider-profile及关联页的modal/actionSheet/error/leave处理 | 已核对静态调用；运行状态待实测（R27） | 未完成 |
| 57 | 发布与恢复 | [检测中撤回再编辑](http://127.0.0.1:4321/?fixture=withdraw) `withdraw` | provider-profile及关联页的modal/actionSheet/error/leave处理 | 已核对静态调用；运行状态待实测（R27） | 未完成 |
| 58 | 发布与恢复 | [发布暂不可用](http://127.0.0.1:4321/?fixture=unavailable) `unavailable` | provider-profile：managementTab=check | 存在差异或缺项，见 R23（R23） | 未完成 |
| 59 | 发布与恢复 | [读取中不显示虚假空态](http://127.0.0.1:4321/?fixture=loading) `loading` | provider-profile及关联页的modal/actionSheet/error/leave处理 | 已核对静态调用；运行状态待实测（R27） | 未完成 |
| 60 | 发布与恢复 | [读取失败原处重试](http://127.0.0.1:4321/?fixture=loadfailed) `loadfailed` | provider-profile及关联页的modal/actionSheet/error/leave处理 | 已核对静态调用；运行状态待实测（R27） | 未完成 |
| 61 | 发布与恢复 | [版本冲突保留本页编辑](http://127.0.0.1:4321/?fixture=conflict) `conflict` | provider-profile及关联页的modal/actionSheet/error/leave处理 | 已核对静态调用；运行状态待实测（R27） | 未完成 |

## 已核实但不能用于放行的事项

- 草稿保存允许不完整内容：`canSaveWork` 当前只要求work.id；不能因旧错误提示文字就推断它仍要求图片齐全。
- `saveAndPreview` 委托只读预览路径，不能仅因旧方法名含save就指控它重复保存；重复保存需运行写请求证据。
- 用户头图空态截图已构成原生不一致证据；已设置头图在HTML映射中不显示，可能是widthFix映射不足，不能据此声称真实头图无法显示。
- 30组辅助图含不同数据、角色、展开状态，禁止计算像素差异作为验收结论；nochange参考是管理页而映射是发布检查，不能直接作为同页对照。
- 所有最终字号、间距、控件状态和返回行为仍需正确AppID、真实账号下完整原生画面。
