import { BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Valida un cuerpo o parámetro con zod; si no cumple, responde 400 con el detalle por campo. */
export function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      statusCode: 400,
      message: 'Datos no válidos',
      errors: result.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
