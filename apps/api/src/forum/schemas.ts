import { z } from 'zod';

// Los límites coinciden con los CHECK de las migraciones 0006 y 0007.

export const idSchema = z.uuid({ message: 'Identificador no válido' });

const name = z.string().trim().min(1, 'El nombre es obligatorio').max(100, 'Máximo 100 caracteres');
const position = z.number().int('La posición debe ser un entero').min(-100_000).max(100_000);

function atLeastOne(value: object): boolean {
  return Object.values(value).some((field) => field !== undefined);
}
const NOTHING_TO_CHANGE = 'No hay nada que cambiar';

export const createCategorySchema = z.object({
  name,
  position: position.optional(),
});

export const updateCategorySchema = z
  .object({
    name: name.optional(),
    position: position.optional(),
  })
  .refine(atLeastOne, NOTHING_TO_CHANGE);

export const createForumSchema = z.object({
  categoryId: idSchema,
  /** Si se indica, se crea un subforo de ese foro (en su misma categoría). */
  parentForumId: idSchema.optional(),
  name,
  description: z.string().trim().max(500, 'Máximo 500 caracteres').optional(),
  position: position.optional(),
});

export const updateForumSchema = z
  .object({
    name: name.optional(),
    description: z.string().trim().max(500, 'Máximo 500 caracteres').optional(),
    position: position.optional(),
    isLocked: z.boolean('isLocked debe ser verdadero o falso').optional(),
  })
  .refine(atLeastOne, NOTHING_TO_CHANGE);

export const createTopicSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio').max(200, 'Máximo 200 caracteres'),
  body: z.string().trim().min(1, 'El mensaje es obligatorio').max(50_000, 'Máximo 50.000 caracteres'),
});

export const createPostSchema = z.object({
  body: z.string().trim().min(1, 'El mensaje es obligatorio').max(50_000, 'Máximo 50.000 caracteres'),
});

/** Paginación por query string (?limit=20&offset=40): llega como texto, así que se convierte. */
export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1, 'limit debe ser al menos 1').max(100, 'limit admite como máximo 100').optional(),
  offset: z.coerce.number().int().min(0, 'offset no puede ser negativo').max(1_000_000).optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateForumInput = z.infer<typeof createForumSchema>;
export type UpdateForumInput = z.infer<typeof updateForumSchema>;
export type CreateTopicInput = z.infer<typeof createTopicSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type PageInput = z.infer<typeof pageSchema>;
