-- Shop-by-shop isolation check, run on a RESTORED COPY of the backup (never on the live database),
-- connected as a superuser of that throwaway database. For every shop in the copy it switches to the
-- API's role (erp_app) with that shop chosen and checks, table by table, that the role sees exactly
-- that shop's rows and none of any other shop's. Prints counts only (no names or amounts).
DO $$
DECLARE
  b record;
  t record;
  own bigint;
  seen bigint;
  other bigint;
  shops int := 0;
  checks int := 0;
BEGIN
  FOR b IN SELECT id FROM businesses ORDER BY created_at LOOP
    shops := shops + 1;
    FOR t IN
      SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
      WHERE s.nspname = 'public' AND c.relkind = 'r'
        AND c.relname <> 'sessions'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped)
      ORDER BY c.relname
    LOOP
      EXECUTE format('SELECT count(*) FROM %I WHERE business_id = $1', t.relname) INTO own USING b.id;
      EXECUTE 'SET LOCAL ROLE erp_app';
      PERFORM set_config('app.business_id', b.id::text, true);
      PERFORM set_config('app.user_id', '', true);
      PERFORM set_config('app.user_email', '', true);
      EXECUTE format('SELECT count(*) FROM %I WHERE business_id IS NOT NULL', t.relname) INTO seen;
      EXECUTE format('SELECT count(*) FROM %I WHERE business_id IS NOT NULL AND business_id <> $1', t.relname) INTO other USING b.id;
      EXECUTE 'RESET ROLE';
      checks := checks + 1;
      IF other > 0 THEN
        RAISE EXCEPTION 'Shop #% can see % rows of other shops in table %.', shops, other, t.relname;
      END IF;
      IF seen <> own THEN
        RAISE EXCEPTION 'Shop #% sees % of its % rows in table %.', shops, seen, own, t.relname;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Isolation OK: % shops x shop tables = % checks, no shop sees another shop''s rows.', shops, checks;
END $$;
