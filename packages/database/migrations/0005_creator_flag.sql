-- Permiso para crear comunidades. Lo activa el propietario de la plataforma desde
-- su panel; el propietario puede crear siempre, sin necesitar este valor.

ALTER TABLE users ADD COLUMN can_create_communities boolean NOT NULL DEFAULT false;
