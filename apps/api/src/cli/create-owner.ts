import * as readline from 'node:readline';
import { ConfigError, describeError, loadRootEnv, parseConfig } from '@goblins/core';
import { createPool, createUser, findUserByEmail } from '@goblins/database';
import { PasswordHasher, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password';
import { registerSchema } from '../auth/schemas';

/** Pregunta sin mostrar lo que se escribe (contraseñas). */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput;
    process.stdout.write(question);
    (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = () => undefined;
    rl.question('', (answer) => {
      (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = write;
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => (rl.close(), resolve(answer))));
}

async function main(): Promise<void> {
  loadRootEnv();
  const config = parseConfig(process.env);

  // Las variables de entorno permiten usarlo sin interacción (instalación automatizada).
  const email = process.env.OWNER_EMAIL ?? (await ask('Email del propietario: '));
  const displayName = process.env.OWNER_NAME ?? (await ask('Nombre visible: '));
  const password =
    process.env.OWNER_PASSWORD ??
    (await askHidden(`Contraseña (${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} caracteres): `));

  const parsed = registerSchema.safeParse({ email, displayName, password });
  if (!parsed.success) {
    console.error('Datos no válidos:');
    for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    process.exit(1);
  }

  const pool = createPool(config.DATABASE_URL);
  try {
    if (await findUserByEmail(pool, parsed.data.email)) {
      console.error(`Ya existe una cuenta con el email ${parsed.data.email}. No se ha cambiado nada.`);
      process.exit(1);
    }
    const user = await createUser(pool, {
      email: parsed.data.email,
      displayName: parsed.data.displayName,
      passwordHash: await new PasswordHasher().hash(parsed.data.password),
      isPlatformOwner: true,
    });
    if (!user) {
      console.error('No se pudo crear la cuenta (el email se registró mientras tanto).');
      process.exit(1);
    }
    console.log(`Propietario creado: ${user.email}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? error.message : `Error: ${describeError(error)}`);
  process.exit(1);
});
