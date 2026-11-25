/**
 * Describe un error de forma útil. Algunos errores de red (ECONNREFUSED) llegan
 * con el mensaje vacío, así que se recurre al código o al nombre.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return error.message || code || error.name;
  }
  return String(error);
}
