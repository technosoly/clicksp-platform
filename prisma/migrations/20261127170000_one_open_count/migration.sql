-- One open stock count per warehouse at a time, so two counts can't both
-- correct the same shelves.
CREATE UNIQUE INDEX inventory_counts_one_open_per_warehouse ON inventory_counts (warehouse_id) WHERE status = 'open';
