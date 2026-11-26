import { NotFoundException } from '@nestjs/common';
import { listUsers, setCanCreateCommunities, type Pool, type UserSummary } from '@goblins/database';

/** Gestión de cuentas desde el panel del propietario. */
export class PlatformService {
  constructor(private readonly pool: Pool) {}

  listUsers(): Promise<UserSummary[]> {
    return listUsers(this.pool);
  }

  /**
   * Activa o retira el permiso de crear comunidades. Retirarlo no toca las que la
   * cuenta ya administra; solo impide crear nuevas. Surte efecto en la siguiente
   * petición, porque el permiso se lee de la base de datos en cada una.
   */
  async setCanCreateCommunities(id: string, enabled: boolean): Promise<UserSummary> {
    if (!(await setCanCreateCommunities(this.pool, id, enabled))) {
      throw new NotFoundException('Cuenta no encontrada');
    }
    const user = (await listUsers(this.pool)).find((u) => u.id === id);
    if (!user) throw new NotFoundException('Cuenta no encontrada');
    return user;
  }
}
