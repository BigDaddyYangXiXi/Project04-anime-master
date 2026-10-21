-- Approved by user and applied 2026-09-25; all eight privileges verified without GRANT OPTION.
-- Evidence: wechat-miniprogram/.artifacts/refund-ledger-grants-verified.json. Do not rerun as a migration.
-- No DELETE, DDL or GRANT OPTION. Existing table permissions remain unchanged.
GRANT SELECT, INSERT, UPDATE ON `cloudbase-d2g65rqbvee0bd978`.`order_refunds` TO 'am_payment'@'172.17.0.0/255.255.240.0';
GRANT SELECT, INSERT ON `cloudbase-d2g65rqbvee0bd978`.`order_refund_reversals` TO 'am_payment'@'172.17.0.0/255.255.240.0';
GRANT SELECT, INSERT ON `cloudbase-d2g65rqbvee0bd978`.`fund_journals` TO 'am_payment'@'172.17.0.0/255.255.240.0';
GRANT INSERT ON `cloudbase-d2g65rqbvee0bd978`.`fund_postings` TO 'am_payment'@'172.17.0.0/255.255.240.0';
