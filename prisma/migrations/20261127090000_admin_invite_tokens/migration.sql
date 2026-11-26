-- Phase 5: one-time "set your password" links for new admin accounts.
-- A separate purpose from password_reset so the two can have different
-- lifetimes (invitation 72 hours, reset 30 minutes) and be audited apart.
ALTER TYPE "verification_purpose" ADD VALUE IF NOT EXISTS 'admin_invite';
