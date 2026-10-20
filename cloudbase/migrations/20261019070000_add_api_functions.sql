CREATE OR REPLACE FUNCTION public.nte_login(p_name text)
RETURNS TABLE (id bigint, name text, data jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_name text;
  v_key  text;
  v_row  public.users%ROWTYPE;
BEGIN
  v_name := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 16);
  IF v_name = '' THEN
    RAISE EXCEPTION '用户名不能为空';
  END IF;
  v_key := lower(v_name);

  SELECT * INTO v_row FROM public.users u WHERE u.name_key = v_key;

  IF NOT FOUND THEN
    INSERT INTO public.users (name_key, name)
    VALUES (v_key, v_name)
    ON CONFLICT (name_key) DO UPDATE SET name = EXCLUDED.name
    RETURNING * INTO v_row;
  ELSIF v_row.name <> v_name THEN
    UPDATE public.users u SET name = v_name, updated_at = now() WHERE u.id = v_row.id;
    v_row.name := v_name;
  END IF;

  RETURN QUERY SELECT v_row.id, v_row.name, v_row.data;
END $fn$;

CREATE OR REPLACE FUNCTION public.nte_pull(p_id bigint)
RETURNS TABLE (id bigint, name text, data jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
    SELECT u.id, u.name, u.data FROM public.users u WHERE u.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '账号不存在';
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.nte_save(p_id bigint, p_data jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count int;
BEGIN
  UPDATE public.users u
     SET data = p_data, updated_at = now()
   WHERE u.id = p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION '账号不存在';
  END IF;
  RETURN true;
END $fn$;

GRANT EXECUTE ON FUNCTION public.nte_login(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nte_pull(bigint) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nte_save(bigint, jsonb) TO anon, authenticated, service_role;
