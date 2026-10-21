-- Business terminology: reference means 参考, not sales or completed orders.
-- Keep the existing identifier and values so older clients and snapshots remain compatible.
ALTER TABLE `works`
  MODIFY COLUMN `reference_count` INT NOT NULL DEFAULT 0 COMMENT '作品被参考次数；不是销量或完成订单数';
