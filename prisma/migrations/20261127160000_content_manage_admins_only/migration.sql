-- The owner's decision: only Super Admins and Business Admins edit the
-- store's information pages (terms, privacy...). content.manage leaves every
-- Store Staff level role (level 3), and the catalogue's maxLevel 2 (synced by
-- the system seed) stops it from being granted to one again.
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND p.key = 'content.manage'
  AND r.level >= 3;

UPDATE permissions SET max_level = 2 WHERE key = 'content.manage' AND max_level > 2;
