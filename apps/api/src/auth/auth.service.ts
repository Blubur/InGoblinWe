import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  addMembership,
  createSession,
  createUser,
  deleteSession,
  findActiveSession,
  findActiveUserById,
  findMembershipRole,
  findUserByEmail,
  withTransaction,
  type Pool,
  type User,
} from '@goblins/database';
import type { Tenant } from '../tenant/tenant';
import type { AuthContext, AuthRole } from './auth';
import type { PasswordHasher } from './password';
import type { LoginInput, RegisterInput } from './schemas';
import { deriveCsrfToken, generateSessionToken, hashToken } from './tokens';

export interface AuthServiceOptions {
  sessionTtlSeconds: number;
}

export interface SessionResult {
  /** Token en claro: solo se entrega una vez, en la cookie. */
  token: string;
  auth: AuthContext;
}

const INVALID_CREDENTIALS = 'Email o contraseña incorrectos';

export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly hasher: PasswordHasher,
    private readonly options: AuthServiceOptions,
  ) {}

  /**
   * Alta en una comunidad. La cuenta es global: si el email ya existe, solo se
   * añade la pertenencia a esta comunidad, y únicamente si la contraseña es la
   * de esa cuenta. Quien no la conozca no averigua nada más que "no se pudo".
   */
  async register(tenant: Tenant, input: RegisterInput): Promise<SessionResult> {
    if (tenant.kind !== 'community') {
      throw new ForbiddenException('El registro no está disponible en el panel central');
    }
    const communityId = tenant.community.id;
    const unavailable = new ConflictException(
      'No se pudo completar el registro: el email ya está en uso o la contraseña no coincide con esa cuenta',
    );

    const existing = await findUserByEmail(this.pool, input.email);
    let user: User;
    if (existing) {
      const matches =
        existing.status === 'active' && (await this.hasher.verify(existing.passwordHash, input.password));
      if (!matches) throw unavailable;
      user = existing;
      if ((await findMembershipRole(this.pool, communityId, user.id)) !== null) {
        throw new ConflictException('Ya eres miembro de esta comunidad: inicia sesión');
      }
      await addMembership(this.pool, communityId, user.id, 'member');
    } else {
      const passwordHash = await this.hasher.hash(input.password);
      // Usuario y membresía juntos: no puede quedar una cuenta a medias.
      const created = await withTransaction(this.pool, async (client) => {
        const newUser = await createUser(client, {
          email: input.email,
          displayName: input.displayName,
          passwordHash,
        });
        if (!newUser) return null; // Otro registro con el mismo email se coló entre medias.
        await addMembership(client, communityId, newUser.id, 'member');
        return newUser;
      });
      if (!created) throw unavailable;
      user = created;
    }

    return this.openSession(user, communityId, 'member');
  }

  async login(tenant: Tenant, input: LoginInput): Promise<SessionResult> {
    const user = await findUserByEmail(this.pool, input.email);
    if (!user) {
      await this.hasher.verifyDummy(input.password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    const passwordOk = await this.hasher.verify(user.passwordHash, input.password);
    if (!passwordOk || user.status !== 'active') throw new UnauthorizedException(INVALID_CREDENTIALS);

    if (tenant.kind === 'platform') {
      if (!user.isPlatformOwner) throw new ForbiddenException('Esta cuenta no puede acceder al panel central');
      return this.openSession(user, null, 'owner');
    }

    const role = await findMembershipRole(this.pool, tenant.community.id, user.id);
    if (role === null) {
      throw new ForbiddenException('No eres miembro de esta comunidad: regístrate con esta misma cuenta');
    }
    return this.openSession(user, tenant.community.id, role);
  }

  async logout(token: string): Promise<void> {
    await deleteSession(this.pool, hashToken(token));
  }

  /**
   * Resuelve la sesión de la cookie para la comunidad actual. Una sesión solo
   * vale en el sitio donde se creó, y se vuelve a comprobar la pertenencia o el
   * rol en cada petición, así que quitar a alguien de una comunidad surte
   * efecto al instante.
   */
  async resolve(tenant: Tenant, token: string): Promise<AuthContext | null> {
    const session = await findActiveSession(this.pool, hashToken(token));
    if (!session) return null;

    const expectedCommunityId = tenant.kind === 'community' ? tenant.community.id : null;
    if (session.communityId !== expectedCommunityId) return null;

    const user = await findActiveUserById(this.pool, session.userId);
    if (!user) return null;

    let role: AuthRole;
    if (tenant.kind === 'platform') {
      if (!user.isPlatformOwner) return null;
      role = 'owner';
    } else {
      const membership = await findMembershipRole(this.pool, tenant.community.id, user.id);
      if (membership === null) return null;
      role = membership;
    }

    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      role,
      csrfToken: deriveCsrfToken(token),
    };
  }

  private async openSession(user: User, communityId: string | null, role: AuthRole): Promise<SessionResult> {
    const token = generateSessionToken();
    await createSession(this.pool, {
      tokenHash: hashToken(token),
      userId: user.id,
      communityId,
      ttlSeconds: this.options.sessionTtlSeconds,
    });
    return {
      token,
      auth: {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        role,
        csrfToken: deriveCsrfToken(token),
      },
    };
  }
}
