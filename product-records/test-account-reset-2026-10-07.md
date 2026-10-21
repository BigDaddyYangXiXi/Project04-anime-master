# 两个测试账号重置

用户明确要求清理数据以首次使用身份测试；选择同时重置云端，并进一步确认“两个都重置”。实时核对公司库仅有站长、亖亖两账号，订单/付款/退款/结算/账本均为空后执行。

先将两个账号暂停防止继续写入。26条媒体记录对应云文件预演找到21个现存文件；精确路径删除后CLI返回异常，未盲目重试。只读列出两个账号的user-uploads前缀均为空，确认文件删除已发生，随后继续清理数据库。没有使用全桶/通配符删除或关闭外键。

定向删除测试项目、橱窗草稿/公开资料、媒体记录，再删除账号并由外键级联清理注册及绑定。回查accounts、wechat_identities、account_phone_identities、account_registration_consents、account_roles、account_discovery_preferences、account_saved_items、provider_catalog_drafts、provider_catalog_publications、project_aggregates、media_assets、media_security_checks均0。系统清理审计及防重放记录保留，不属于两个用户的业务状态；未改支付配置或资金事实。

官方开发工具CLI对唯一客户端执行cache --clean storage及cache --clean file均成功，核对AppID为wxc94e1c1b38944511。未清开发者登录、未切自动化、未重建客户端。手机本地缓存及微信系统位置/隐私授权无法由桌面CLI远程清理，不能声称手机端全部复位；手机端需自行清理该小程序本地数据并重新进入。无需用户执行代码或提供截图。

证据：wechat-miniprogram/.artifacts/reset-two-test-accounts-result-20261007.json。重置脚本只接受两个固定账号，带资金空表和路径检查；成功后不应重跑或自行重建账号/测试数据。用户现在准备首次使用测试，总目标仍未完成。
