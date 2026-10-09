-- Read-only check that row-level security protects the live database.
-- Run it connected as the API's role (erp_app), e.g. from the daily backup workflow, or paste it
-- into the Neon SQL Editor after `SET ROLE erp_app;`. It changes nothing; it stops with an error
-- (and the workflow goes red) if any rule is broken.
--
--  1. The role is an ordinary one: not a superuser, cannot bypass row-level security, owns no tables.
--  2. Every table with a business_id column has row-level security switched on and forced.
--  3. With no shop chosen, and with a shop id that does not exist, no shop's rows are visible.
-- `sessions` is left out on purpose: it is an account-level table (like `users`), read at sign-in
-- before any shop is chosen; its business_id is only the shop the person last opened, and it holds
-- token hashes, not shop data.
DO $$
DECLARE
  r record;
  n bigint;
  tables int := 0;
  probe text := gen_random_uuid()::text;
BEGIN
  IF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Role % can bypass row-level security: the API must not connect with it.', current_user;
  END IF;

  FOR r IN
    SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
    WHERE s.nspname = 'public' AND c.relkind = 'r'
      AND c.relname <> 'sessions'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped)
    ORDER BY c.relname
  LOOP
    tables := tables + 1;
    IF r.owner = current_user THEN
      RAISE EXCEPTION 'Role % owns table %: the API role must not own tables.', current_user, r.relname;
    END IF;
    IF NOT (r.relrowsecurity AND r.relforcerowsecurity) THEN
      RAISE EXCEPTION 'Table % does not have row-level security switched on and forced.', r.relname;
    END IF;

    -- no shop chosen
    PERFORM set_config('app.business_id', '', true);
    PERFORM set_config('app.user_id', '', true);
    PERFORM set_config('app.user_email', '', true);
    EXECUTE format('SELECT count(*) FROM %I WHERE business_id IS NOT NULL', r.relname) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Table % shows % shop rows with no shop chosen.', r.relname, n;
    END IF;

    -- a shop that does not exist
    PERFORM set_config('app.business_id', probe, true);
    EXECUTE format('SELECT count(*) FROM %I WHERE business_id IS NOT NULL', r.relname) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Table % shows % rows of other shops to a shop that does not exist.', r.relname, n;
    END IF;
  END LOOP;

  IF tables < 20 THEN
    RAISE EXCEPTION 'Only % shop tables found: is this the right database?', tables;
  END IF;
  RAISE NOTICE 'Row-level security OK: % shop tables checked as role %.', tables, current_user;
END $$;
