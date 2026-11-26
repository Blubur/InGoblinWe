import { z } from 'zod';

/**
 * Subdominios que no se pueden asignar a una comunidad porque la plataforma
 * podría necesitarlos para su propia infraestructura.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www',
  'api',
  'admin',
  'app',
  'mail',
  'smtp',
  'ftp',
  'static',
  'assets',
  'cdn',
  'platform',
  'central',
  'status',
  'docs',
  'help',
  'support',
  'login',
  'localhost',
]);

// Mismo patrón que el CHECK de la tabla communities, con un mínimo de 3 caracteres.
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'El identificador debe tener al menos 3 caracteres')
  .max(63, 'El identificador admite como máximo 63 caracteres')
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    'Solo letras minúsculas, números y guiones, sin empezar ni terminar en guion',
  )
  .refine((value) => !RESERVED_SLUGS.has(value), 'Ese identificador está reservado');

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'El email no es válido' }));

export const createCommunitySchema = z.object({
  slug,
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(80, 'Máximo 80 caracteres'),
  /** Cuenta que administrará la comunidad. Si se omite, la del propietario que la crea. */
  adminEmail: email.optional(),
});

export const communityIdSchema = z.uuid({ message: 'Identificador de comunidad no válido' });

export const setStatusSchema = z.object({
  status: z.enum(['active', 'suspended'], { message: 'El estado debe ser "active" o "suspended"' }),
});

export type CreateCommunityInput = z.infer<typeof createCommunitySchema>;
export type SetStatusInput = z.infer<typeof setStatusSchema>;
