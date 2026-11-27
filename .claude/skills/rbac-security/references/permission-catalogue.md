# Permission catalogue and default bundles

Legend: SA = Super Admin (level 1), BA = Business Admin (level 2), ST = Store Staff (level 3).
`S` = granted but scoped (category/warehouse scopes), `P` = `.propose` only (goes to approval).
Super Admin can change bundles; escalation guards still apply.

| Permission key | SA | BA | ST |
|---|---|---|---|
| product.view | ✓ | ✓ | S |
| product.create | ✓ | ✓ | S |
| product.update | ✓ | ✓ | S |
| product.archive | ✓ | ✓ | – |
| product.delete_permanent | ✓ (MFA) | – | – |
| media.upload | ✓ | ✓ | S |
| price.update | ✓ | ✓ | P |
| discount.manage | ✓ | ✓ | – |
| coupon.manage | ✓ | ✓ | – |
| category.manage | ✓ | ✓ | S |
| brand.manage | ✓ | ✓ | S |
| vehicle.manage | ✓ | ✓ | S |
| compatibility.manage | ✓ | ✓ | S (creates unverified) |
| compatibility.verify | ✓ | ✓ | – |
| import.run | ✓ | ✓ | – |
| inventory.view | ✓ | ✓ | S |
| inventory.receive | ✓ | ✓ | S |
| inventory.issue | ✓ | ✓ | S |
| inventory.count | ✓ | ✓ | S |
| inventory.adjust | ✓ | ✓ | P (above threshold) |
| warehouse.manage | ✓ | ✓ | – |
| order.view | ✓ | ✓ | S (no payment data) |
| order.fulfil | ✓ | ✓ | S |
| order.cancel | ✓ | ✓ | – |
| return.manage | ✓ | ✓ | – |
| refund.create | ✓ | ✓ (MFA above threshold) | – |
| customer.view | ✓ | ✓ | – |
| accounting.view | ✓ | ✓ | – |
| accounting.post | ✓ | ✓ | – |
| accounting.period_close | ✓ | ✓ (MFA) | – |
| expense.manage | ✓ | ✓ | – |
| report.financial | ✓ | ✓ | – |
| report.sales | ✓ | ✓ | – |
| payment_provider.view | ✓ | ✓ | – |
| payment_provider.configure | ✓ (MFA) | – | – |
| shipping.configure | ✓ | ✓ | – |
| article.manage | ✓ | ✓ | S |
| content.manage | ✓ | ✓ | – |
| menu.manage | ✓ | ✓ | – |
| banner.manage | ✓ | ✓ | – |
| pagebuilder.edit | ✓ | – | – |
| pagebuilder.publish | ✓ | – | – |
| theme.manage | ✓ | – | – |
| user.manage_staff | ✓ | ✓ | – |
| user.manage_admins | ✓ | – | – |
| role.manage | ✓ (MFA) | – | – |
| settings.store | ✓ | ✓ | – |
| settings.system | ✓ (MFA) | – | – |
| integration.manage | ✓ (MFA) | – | – |
| backup.view | ✓ | – | – |
| backup.run | ✓ (MFA) | – | – |
| deployment.view | ✓ | – | – |
| deployment.request | ✓ (MFA) | – | – |
| audit.view_all | ✓ | – | – |
| audit.view_business | ✓ | ✓ | – |
| monitoring.view | ✓ | – | – |
