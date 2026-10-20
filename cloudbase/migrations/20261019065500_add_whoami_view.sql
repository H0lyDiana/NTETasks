CREATE OR REPLACE VIEW public.nte_whoami_v AS SELECT current_user::text AS role;

GRANT SELECT ON public.nte_whoami_v TO PUBLIC;
