-- Estructura del foro: categorías, foros y subforos.
--
-- Aislamiento: cada tabla lleva community_id, y las referencias entre tablas de una
-- comunidad usan claves foráneas COMPUESTAS (community_id, id). Así la propia base de
-- datos impide que un foro cuelgue de una categoría de otra comunidad, aunque el código
-- de la aplicación tuviera un fallo.
--
-- Borrado: borrar una categoría con foros, o un foro con subforos, falla a propósito
-- (clave 23503) para que haya que vaciarlo o moverlo antes. Borrar la comunidad entera
-- sí arrastra todo.

CREATE TABLE categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100 AND btrim(name) <> ''),
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, id)
);

CREATE INDEX categories_order_idx ON categories (community_id, position, name);

CREATE TABLE forums (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    uuid NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
  category_id     uuid NOT NULL,
  -- NULL = foro de primer nivel; con valor = subforo de ese foro.
  parent_forum_id uuid,
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100 AND btrim(name) <> ''),
  description     text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  position        integer NOT NULL DEFAULT 0,
  is_locked       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, id),
  UNIQUE (community_id, category_id, id),
  CHECK (parent_forum_id IS NULL OR parent_forum_id <> id),
  FOREIGN KEY (community_id, category_id) REFERENCES categories (community_id, id),
  -- El subforo está en la misma comunidad y en la misma categoría que su foro padre.
  FOREIGN KEY (community_id, category_id, parent_forum_id) REFERENCES forums (community_id, category_id, id)
);

CREATE INDEX forums_category_idx ON forums (community_id, category_id, position, name);
CREATE INDEX forums_parent_idx ON forums (community_id, parent_forum_id) WHERE parent_forum_id IS NOT NULL;

-- Un foro no puede colgar de uno de sus propios descendientes.
CREATE FUNCTION forums_prevent_cycle() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_forum_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_forum_id FROM forums WHERE id = NEW.parent_forum_id
      UNION ALL
      SELECT f.id, f.parent_forum_id FROM forums f JOIN ancestors a ON f.id = a.parent_forum_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'un foro no puede ser descendiente de sí mismo' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER forums_prevent_cycle_trg
  BEFORE INSERT OR UPDATE OF parent_forum_id ON forums
  FOR EACH ROW EXECUTE FUNCTION forums_prevent_cycle();
