-- 用户展示 ID（对外，不暴露自增序号）
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_id VARCHAR(10);

-- 给已有用户生成 display_id
DO $$
DECLARE
  r RECORD;
  rand_str TEXT;
BEGIN
  FOR r IN SELECT id FROM users WHERE display_id IS NULL LOOP
    LOOP
      rand_str := 'U-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 6));
      BEGIN
        UPDATE users SET display_id = rand_str WHERE id = r.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- retry with a different random string
      END;
    END LOOP;
  END LOOP;
END $$;

-- 此后新用户由 auth-activate 在创建时生成
ALTER TABLE users ADD CONSTRAINT users_display_id_unique UNIQUE (display_id);
