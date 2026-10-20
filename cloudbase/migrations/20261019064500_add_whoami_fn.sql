CREATE OR REPLACE FUNCTION public.nte_whoami()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$ SELECT current_user::text $fn$;

GRANT EXECUTE ON FUNCTION public.nte_whoami() TO PUBLIC;
