import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'es obligatoria'),
  REDIS_URL: z.string().min(1, 'es obligatoria'),
  PLATFORM_BASE_DOMAIN: z.string().min(1).default('localhost'),
});

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

interface Issue {
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

function formatIssues(issues: ReadonlyArray<Issue>): string {
  return issues
    .map((issue) => `  - ${issue.path.map(String).join('.') || '(raíz)'}: ${issue.message}`)
    .join('\n');
}

/** Valida y tipa la configuración completa. Lanza ConfigError con un mensaje legible. */
export function parseConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(
      `Configuración inválida (revisa tu archivo .env):\n${formatIssues(result.error.issues)}`,
    );
  }
  return result.data;
}

const databaseEnvSchema = envSchema.pick({ DATABASE_URL: true });

/** Para herramientas (migraciones) que solo necesitan la base de datos. */
export function parseDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const result = databaseEnvSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(
      `Configuración inválida (revisa tu archivo .env):\n${formatIssues(result.error.issues)}`,
    );
  }
  return result.data.DATABASE_URL;
}
