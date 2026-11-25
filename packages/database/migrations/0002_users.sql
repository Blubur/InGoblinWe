-- Cuentas globales. Una persona tiene una sola cuenta; su pertenencia a cada
-- comunidad se registra aparte en memberships.

CREATE TYPE user_status AS ENUM ('active', 'disabled');

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL UNIQUE
                    CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+$'),
  display_name      text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 64),
  password_hash     text NOT NULL,
  is_platform_owner boolean NOT NULL DEFAULT false,
  status            user_status NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
