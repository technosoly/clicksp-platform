/** Tables that hold business data: the system seed must leave every one empty. */
export const BUSINESS_TABLES = [
  "users", "user_profiles", "sessions", "manufacturers", "brands", "categories", "attribute_definitions",
  "products", "product_translations", "product_variants", "product_prices", "product_identifiers",
  "product_compatibilities", "compatibility_sources", "motorcycle_manufacturers", "motorcycle_brands",
  "motorcycle_models", "motorcycle_generations", "motorcycle_variants", "customer_vehicles", "warehouses",
  "warehouse_locations", "inventory_balances", "inventory_movements", "stock_reservations", "carts", "orders",
  "order_items", "coupons", "delivery_addresses", "financial_accounts", "account_mappings", "financial_periods",
  "accounting_transactions", "accounting_entries", "expenses", "income_records", "cash_registers",
  "payment_providers", "payment_transactions", "shipping_providers", "shipping_methods", "shipping_zones",
  "shipping_rates", "shipments", "tax_rules", "articles", "pages", "page_templates", "page_builder_components",
  "menus", "banners", "media_library", "feature_flags", "audit_logs",
] as const;
