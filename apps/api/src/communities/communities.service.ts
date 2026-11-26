import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  createCommunity,
  findUserByEmail,
  listCommunities,
  setCommunityStatus,
  type CommunityRef,
  type CommunityStatus,
  type CommunitySummary,
  type Pool,
} from '@goblins/database';
import type { CreateCommunityInput } from './schemas';

export interface CreatedCommunity extends CommunityRef {
  host: string;
}

export class CommunitiesService {
  constructor(
    private readonly pool: Pool,
    /** Dominio base de la plataforma: cada comunidad vive en <slug>.<baseDomain>. */
    private readonly baseDomain: string,
  ) {}

  /**
   * Crea una comunidad con su subdominio. La cuenta administradora se comprueba
   * antes de crear nada, para no dejar una comunidad sin nadie que la administre.
   */
  async create(input: CreateCommunityInput, ownerEmail: string): Promise<CreatedCommunity> {
    const adminEmail = input.adminEmail ?? ownerEmail;
    const admin = await findUserByEmail(this.pool, adminEmail);
    if (!admin || admin.status !== 'active') {
      throw new BadRequestException('No hay ninguna cuenta activa con el email del administrador');
    }

    const host = `${input.slug}.${this.baseDomain.toLowerCase()}`;
    const result = await createCommunity(this.pool, {
      slug: input.slug,
      name: input.name,
      host,
      adminUserId: admin.id,
    });
    if (!result.ok) {
      throw new ConflictException('Ya existe una comunidad con ese identificador');
    }
    return { ...result.community, host };
  }

  list(): Promise<CommunitySummary[]> {
    return listCommunities(this.pool);
  }

  async setStatus(id: string, status: CommunityStatus): Promise<CommunityRef> {
    const community = await setCommunityStatus(this.pool, id, status);
    if (!community) throw new NotFoundException('Comunidad no encontrada');
    return community;
  }
}
