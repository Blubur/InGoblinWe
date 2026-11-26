import { z } from 'zod';

export const userIdSchema = z.uuid({ message: 'Identificador de cuenta no válido' });

/** Cambios que el propietario puede hacer en una cuenta. Por ahora, solo el interruptor de creador. */
export const updateUserSchema = z.object({
  canCreateCommunities: z.boolean({ message: 'canCreateCommunities debe ser true o false' }),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
