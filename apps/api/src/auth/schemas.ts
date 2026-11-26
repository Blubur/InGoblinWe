import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'El email no es válido' }));

export const registerSchema = z.object({
  email,
  displayName: z.string().trim().min(1, 'El nombre es obligatorio').max(64, 'Máximo 64 caracteres'),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`)
    .max(PASSWORD_MAX_LENGTH, `La contraseña admite como máximo ${PASSWORD_MAX_LENGTH} caracteres`),
});

// En el login no se aplica la política de longitud: solo se comprueba la contraseña.
export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
