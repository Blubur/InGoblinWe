-- Raíz del modelo multi-comunidad: cada comunidad y los hosts que la resuelven.
-- Todas las tablas futuras de una comunidad llevarán community_id hacia communities(id).

CREATE TYPE community_status AS ENUM ('active', 'suspended');

CREATE TABLE communities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE
             CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  name       text NOT NULL,
  status     community_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE community_domains (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  host         text NOT NULL UNIQUE CHECK (host = lower(host)),
  is_primary   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX community_domains_community_id_idx ON community_domains (community_id);

-- Como máximo un dominio principal por comunidad.
CREATE UNIQUE INDEX community_domains_one_primary_idx
  ON community_domains (community_id)
  WHERE is_primary;
