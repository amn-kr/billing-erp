-- Row-level security, app-role grants and the four system roles.
--
-- The API connects as the role `erp_app` (no BYPASSRLS, not the table owner)
-- and, inside each request's transaction, sets:
--   app.business_id  the shop the request is for
--   app.user_id      the signed-in person
--   app.user_email   their email (to see invites addressed to them)
-- Every shop-owned table only shows and accepts rows for app.business_id.
-- Create the role first (see infra/db/init.sql).

CREATE FUNCTION app_business_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.business_id', true), '')::uuid $$;
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app_user_email() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_email', true), '') $$;

-- Business codes shown in the account menu (BE-1001, BE-1002, ...)
CREATE SEQUENCE business_code_seq START 1001;

-- System roles are unique by key (NULL business_id is not covered by the unique constraint)
CREATE UNIQUE INDEX roles_system_key ON roles (key) WHERE business_id IS NULL;
CREATE UNIQUE INDEX invites_open_per_email ON invites (business_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ── businesses: your current shop, shops you belong to, shops that invited you
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses FORCE ROW LEVEL SECURITY;
CREATE POLICY businesses_read ON businesses FOR SELECT USING (
  id = app_business_id()
  OR id IN (SELECT business_id FROM memberships WHERE user_id = app_user_id() AND status = 'active')
  OR id IN (SELECT business_id FROM invites WHERE email = app_user_email() AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())
);
CREATE POLICY businesses_insert ON businesses FOR INSERT WITH CHECK (id = app_business_id() AND owner_user_id = app_user_id());
CREATE POLICY businesses_update ON businesses FOR UPDATE USING (id = app_business_id()) WITH CHECK (id = app_business_id());

-- ── memberships: your shop's members, and your own memberships in any shop
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_read ON memberships FOR SELECT USING (business_id = app_business_id() OR user_id = app_user_id());
CREATE POLICY memberships_insert ON memberships FOR INSERT WITH CHECK (business_id = app_business_id());
CREATE POLICY memberships_update ON memberships FOR UPDATE USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());

-- ── invites: your shop's invites, and invites addressed to your email
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites FORCE ROW LEVEL SECURITY;
CREATE POLICY invites_read ON invites FOR SELECT USING (business_id = app_business_id() OR email = app_user_email());
CREATE POLICY invites_insert ON invites FOR INSERT WITH CHECK (business_id = app_business_id());
CREATE POLICY invites_update ON invites FOR UPDATE USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());

-- ── roles and their permissions: system roles (NULL) plus your shop's own
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_read ON roles FOR SELECT USING (business_id IS NULL OR business_id = app_business_id());
CREATE POLICY roles_write ON roles FOR INSERT WITH CHECK (business_id = app_business_id());
CREATE POLICY roles_update ON roles FOR UPDATE USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_read ON role_permissions FOR SELECT USING (business_id IS NULL OR business_id = app_business_id());
CREATE POLICY role_permissions_write ON role_permissions FOR INSERT WITH CHECK (business_id = app_business_id());
CREATE POLICY role_permissions_update ON role_permissions FOR UPDATE USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());

-- ── plain shop-owned tables: only the current shop
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions','subscription_payments','business_settings','financial_years','document_series','tax_rates','audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id())', t || '_tenant', t);
  END LOOP;
END $$;

-- ── grants for the app role: read, add and change — never delete
GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO erp_app;
DO $$ BEGIN IF to_regclass('_prisma_migrations') IS NOT NULL THEN REVOKE ALL ON _prisma_migrations FROM erp_app; END IF; END $$;
REVOKE UPDATE ON audit_log FROM erp_app;
GRANT USAGE ON SEQUENCE business_code_seq TO erp_app;
GRANT EXECUTE ON FUNCTION app_business_id(), app_user_id(), app_user_email() TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO erp_app;

ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions NO FORCE ROW LEVEL SECURITY;
-- ── system roles (must match DEFAULT_ROLE_PERMISSIONS in packages/shared; an API test checks this)
INSERT INTO roles (business_id, key, name) VALUES (NULL, 'owner', 'Owner');
INSERT INTO role_permissions (role_id, business_id, permission) SELECT id, NULL, p FROM roles, unnest(ARRAY['business.view', 'business.update', 'members.view', 'members.manage', 'billing.manage', 'audit.view', 'masters.view', 'masters.manage', 'sales.view', 'sales.create', 'sales.cancel', 'purchases.view', 'purchases.manage', 'money.view', 'money.manage', 'reports.view', 'settings.manage']) AS p WHERE business_id IS NULL AND key = 'owner';
INSERT INTO roles (business_id, key, name) VALUES (NULL, 'manager', 'Manager');
INSERT INTO role_permissions (role_id, business_id, permission) SELECT id, NULL, p FROM roles, unnest(ARRAY['business.view', 'members.view', 'members.manage', 'audit.view', 'masters.view', 'masters.manage', 'sales.view', 'sales.create', 'sales.cancel', 'purchases.view', 'purchases.manage', 'money.view', 'money.manage', 'reports.view', 'settings.manage']) AS p WHERE business_id IS NULL AND key = 'manager';
INSERT INTO roles (business_id, key, name) VALUES (NULL, 'billing_staff', 'Billing staff');
INSERT INTO role_permissions (role_id, business_id, permission) SELECT id, NULL, p FROM roles, unnest(ARRAY['business.view', 'masters.view', 'sales.view', 'sales.create', 'money.view']) AS p WHERE business_id IS NULL AND key = 'billing_staff';
INSERT INTO roles (business_id, key, name) VALUES (NULL, 'accountant', 'Accountant');
INSERT INTO role_permissions (role_id, business_id, permission) SELECT id, NULL, p FROM roles, unnest(ARRAY['business.view', 'members.view', 'audit.view', 'masters.view', 'sales.view', 'purchases.view', 'purchases.manage', 'money.view', 'money.manage', 'reports.view']) AS p WHERE business_id IS NULL AND key = 'accountant';
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
