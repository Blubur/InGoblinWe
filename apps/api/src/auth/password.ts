import { Algorithm, hash, verify } from '@node-rs/argon2';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export interface HasherOptions {
  /** Memoria en KiB. Por defecto 19 MiB, el mínimo que recomienda OWASP para Argon2id. */
  memoryCost?: number;
  timeCost?: number;
  parallelism?: number;
}

/**
 * Contraseñas con Argon2id. Los parámetros viajan dentro del propio hash, así
 * que se pueden endurecer más adelante sin invalidar las contraseñas actuales.
 */
export class PasswordHasher {
  private readonly options: Required<HasherOptions>;
  private dummyHash: Promise<string> | undefined;

  constructor(options: HasherOptions = {}) {
    this.options = {
      memoryCost: options.memoryCost ?? 19_456,
      timeCost: options.timeCost ?? 2,
      parallelism: options.parallelism ?? 1,
    };
  }

  hash(password: string): Promise<string> {
    return hash(password, { algorithm: Algorithm.Argon2id, ...this.options });
  }

  /** Falso (en lugar de error) si el hash está dañado o la contraseña no coincide. */
  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Hace el mismo trabajo que una comprobación real contra un hash ficticio.
   * Se usa cuando el usuario no existe, para que responder "no existe" no sea
   * visiblemente más rápido que responder "contraseña incorrecta".
   */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('contraseña-ficticia-no-valida');
    await this.verify(await this.dummyHash, password);
  }
}
