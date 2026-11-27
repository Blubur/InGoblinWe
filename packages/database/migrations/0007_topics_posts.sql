-- Temas y mensajes.
--
-- El autor debe ser miembro de la comunidad (clave compuesta hacia memberships). Si la
-- membresía o la cuenta desaparece, el mensaje se conserva con author_id NULL.
-- ON DELETE SET NULL (columna) necesita PostgreSQL 15 o superior.
--
-- El texto se guarda tal cual lo escribió la persona. No se guarda HTML: quien lo muestre
-- debe escaparlo o sanearlo al renderizar.

CREATE TABLE topics (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  forum_id     uuid NOT NULL,
  author_id    uuid,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200 AND btrim(title) <> ''),
  is_pinned    boolean NOT NULL DEFAULT false,
  is_locked    boolean NOT NULL DEFAULT false,
  reply_count  integer NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
  last_post_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, id),
  FOREIGN KEY (community_id, forum_id) REFERENCES forums (community_id, id),
  FOREIGN KEY (community_id, author_id) REFERENCES memberships (community_id, user_id)
    ON DELETE SET NULL (author_id)
);

-- Listado de un foro: fijados primero y luego por actividad reciente.
CREATE INDEX topics_forum_listing_idx ON topics (community_id, forum_id, is_pinned DESC, last_post_at DESC, id);
CREATE INDEX topics_author_idx ON topics (community_id, author_id) WHERE author_id IS NOT NULL;

CREATE TABLE posts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Orden estable dentro de un tema; el primer mensaje del tema es el de menor seq.
  seq          bigint GENERATED ALWAYS AS IDENTITY,
  community_id uuid NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  topic_id     uuid NOT NULL,
  author_id    uuid,
  body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 50000 AND btrim(body) <> ''),
  created_at   timestamptz NOT NULL DEFAULT now(),
  edited_at    timestamptz,
  UNIQUE (community_id, id),
  FOREIGN KEY (community_id, topic_id) REFERENCES topics (community_id, id) ON DELETE CASCADE,
  FOREIGN KEY (community_id, author_id) REFERENCES memberships (community_id, user_id)
    ON DELETE SET NULL (author_id)
);

CREATE INDEX posts_topic_idx ON posts (community_id, topic_id, seq);
CREATE INDEX posts_author_idx ON posts (community_id, author_id) WHERE author_id IS NOT NULL;
