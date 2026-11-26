# Entity relationship diagrams

Implemented in Phase 3. Diagrams show the main tables and keys per area; every column, index and rule is in `prisma/schema/*.prisma` and [DATABASE.md](DATABASE.md). Translation tables (`*_translations`, keyed by entity and `locale`) are drawn only where they matter.

## Identity, RBAC and audit

```mermaid
erDiagram
  users ||--o| user_profiles : has
  users ||--o{ auth_accounts : "signs in with"
  users ||--o{ sessions : has
  users ||--o| user_mfa : enrols
  users ||--o{ verification_tokens : receives
  users ||--o{ login_attempts : "login history"
  users ||--o{ user_roles : holds
  roles ||--o{ user_roles : "assigned in"
  roles ||--o{ role_permissions : grants
  permissions ||--o{ role_permissions : "granted by"
  user_roles ||--o{ user_role_scopes : "limited to"
  user_role_scopes }o--o| categories : category
  user_role_scopes }o--o| warehouses : warehouse
  users ||--o{ admin_approvals : requests
  users ||--o{ audit_logs : acts
  users ||--o{ security_events : triggers

  roles {
    uuid id PK
    varchar key UK
    smallint level "1 SA, 2 BA, 3 Staff, 0 Customer"
    bool is_system
  }
  permissions {
    uuid id PK
    varchar key UK
    scope_type scope_type
    smallint max_level
    bool requires_mfa
  }
  role_permissions {
    uuid role_id PK
    uuid permission_id PK
    bool is_scoped
  }
  audit_logs {
    uuid id PK
    bigint seq UK
    bytea prev_hash
    bytea hash
  }
```

## Catalog

```mermaid
erDiagram
  manufacturers ||--o{ brands : owns
  brands ||--o{ products : brands
  manufacturers ||--o{ products : makes
  categories ||--o{ categories : parent
  categories ||--o{ product_categories : contains
  products ||--o{ product_categories : "listed in"
  products ||--o{ product_translations : "fa / en"
  products ||--|{ product_variants : "sold as"
  product_variants ||--o{ product_prices : "price history"
  products ||--o{ product_attributes : has
  attribute_definitions ||--o{ product_attributes : defines
  attribute_definitions ||--o{ attribute_options : options
  categories ||--o{ category_attributes : uses
  products ||--o{ product_images : shows
  products ||--o{ product_documents : documents
  products ||--o{ product_identifiers : "OEM / part numbers"
  products ||--o{ product_relations : "replacement, accessory..."
  media_library ||--o{ product_images : file

  product_variants {
    uuid id PK
    varchar sku
    varchar sku_normalized UK
    bigint price "Rial"
    bigint compare_at_price
    char currency_code
  }
  product_identifiers {
    uuid id PK
    identifier_type type
    varchar value
    varchar normalized_value
  }
```

## Motorcycles and fitment

```mermaid
erDiagram
  motorcycle_manufacturers ||--o{ motorcycle_brands : markets
  motorcycle_brands ||--o{ motorcycle_models : "make > model"
  motorcycle_models ||--o{ motorcycle_generations : "production years"
  motorcycle_generations ||--o{ motorcycle_variants : "engine / market"
  motorcycle_variants ||--o{ motorcycle_specifications : specs
  products ||--o{ product_compatibilities : fits
  motorcycle_variants ||--o{ product_compatibilities : "exact variant"
  motorcycle_generations ||--o{ product_compatibilities : "whole generation"
  compatibility_sources ||--o{ product_compatibilities : "evidence"
  users ||--o{ customer_vehicles : "my garage"
  motorcycle_variants ||--o{ customer_vehicles : saved

  product_compatibilities {
    uuid product_id FK
    uuid motorcycle_variant_id FK "one of"
    uuid motorcycle_generation_id FK "one of"
    smallint year_from
    smallint year_to
    fitment_position position
    uuid source_id FK
    verification_status verification_status
  }
```

## Inventory

```mermaid
erDiagram
  warehouses ||--o{ warehouse_locations : bins
  product_variants ||--o{ inventory_balances : stocked
  warehouse_locations ||--o{ inventory_balances : holds
  inventory_balances ||--o{ inventory_movements : "ledger (append-only)"
  inventory_balances ||--o{ stock_reservations : holds
  orders ||--o{ stock_reservations : reserves
  carts ||--o{ stock_reservations : reserves
  warehouses ||--o{ stock_adjustments : adjusts
  stock_adjustments ||--o{ stock_adjustment_lines : lines
  warehouses ||--o{ inventory_counts : counts
  inventory_counts ||--o{ inventory_count_lines : lines
  stock_transfers ||--o{ stock_transfer_lines : lines
  stock_transfers ||--o{ inventory_movements : "out + in"
  product_variants ||--o{ stock_alerts : thresholds

  inventory_balances {
    uuid variant_id UK
    uuid location_id UK
    int on_hand ">= 0"
    int reserved "<= on_hand"
  }
  inventory_movements {
    movement_type type
    int quantity "> 0"
    int on_hand_after
  }
```

## Sales, payments and shipping

```mermaid
erDiagram
  users ||--o{ carts : owns
  carts ||--o{ cart_items : contains
  users ||--o{ wishlists : keeps
  wishlists ||--o{ wishlist_items : contains
  users ||--o{ orders : places
  orders ||--|{ order_items : "snapshot lines"
  orders ||--o{ order_status_history : "state changes"
  orders ||--o{ order_addresses : "address snapshot"
  users ||--o{ delivery_addresses : "address book"
  coupons ||--o{ orders : discounts
  coupons ||--o{ coupon_redemptions : used
  orders ||--o{ order_returns : returns
  order_returns ||--o{ order_return_items : lines
  orders ||--o{ order_refunds : refunds
  orders ||--o{ invoices : invoiced
  orders ||--o{ payment_transactions : "paid by"
  payment_providers ||--o{ payment_transactions : gateway
  payment_transactions ||--o{ payment_callback_logs : callbacks
  shipping_providers ||--o{ shipping_methods : offers
  shipping_methods ||--o{ shipping_rates : priced
  shipping_zones ||--o{ shipping_rates : "per zone"
  shipping_zones ||--o{ shipping_zone_regions : provinces
  orders ||--o{ shipments : "shipped as"
  shipments ||--o{ shipment_items : contains
  shipments ||--o{ shipment_tracking_events : tracking

  orders {
    bigint order_number UK
    order_status status
    bigint subtotal
    bigint discount_total
    bigint shipping_total
    bigint tax_total
    bigint grand_total
  }
  payment_transactions {
    varchar our_reference UK
    varchar provider_reference
    payment_status status
    bigint amount
  }
```

## Accounting

```mermaid
erDiagram
  financial_accounts ||--o{ financial_accounts : parent
  financial_periods ||--o{ accounting_transactions : contains
  accounting_transactions ||--|{ accounting_entries : "debit / credit lines"
  financial_accounts ||--o{ accounting_entries : posted
  accounting_transactions |o--o| accounting_transactions : reverses
  financial_accounts ||--o{ account_mappings : "posting role"
  financial_accounts ||--o{ cash_registers : "cash / bank"
  accounting_transactions ||--o{ expenses : records
  accounting_transactions ||--o{ income_records : records
  accounting_transactions ||--o{ payment_transactions : records
  financial_accounts ||--o{ reconciliation_statements : statement
  reconciliation_statements ||--o{ reconciliation_lines : lines

  accounting_transactions {
    bigint journal_number UK
    date entry_date
    journal_status status
    journal_source_type source_type
    uuid source_id
    uuid reverses_id UK
  }
  accounting_entries {
    bigint debit
    bigint credit "exactly one > 0"
  }
```

## Content, page builder and system

```mermaid
erDiagram
  articles ||--o{ article_translations : "fa / en"
  article_categories ||--o{ articles : groups
  articles ||--o{ article_tag_assignments : tagged
  article_tags ||--o{ article_tag_assignments : tags
  articles ||--o{ article_images : images
  pages ||--o{ page_revisions : "revision history"
  pages |o--o| page_revisions : "published revision"
  page_templates ||--o{ pages : template
  banners ||--o{ banner_translations : "fa / en"
  media_library ||--o{ banners : images
  release_versions ||--o{ deployment_records : deployed
  background_jobs ||--o{ failed_jobs : failures
  data_import_jobs ||--o{ data_import_rows : rows
```

Standalone system tables: `locales`, `currencies`, `system_settings`, `store_settings`, `tax_rules`, `seo_metadata`, `feature_flags`, `page_sections`, `page_builder_components`, `menus`, `outbox_events`, `idempotency_keys`, `notifications`, `system_logs`, `data_export_jobs`.
