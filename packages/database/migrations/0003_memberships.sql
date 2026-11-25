-- Pertenencia de un usuario a una comunidad, con su rol dentro de ella.
-- El propietario de la plataforma se marca en users, no aquí.

CREATE TYPE membership_role AS ENUM ('admin', 'member');

CREATE TABLE memberships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         membership_role NOT NULL DEFAULT 'member',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, user_id)
);

CREATE INDEX memberships_user_id_idx ON memberships (user_id);
