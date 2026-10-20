CREATE TABLE public.users (
  id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name_key   TEXT        NOT NULL UNIQUE,
  name       TEXT        NOT NULL,
  data       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
