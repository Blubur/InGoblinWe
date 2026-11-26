import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthContext, AuthRequest } from '../auth/auth';
import { parse } from '../common/parse';
import { CommunitiesService } from './communities.service';
import { communityIdSchema, createCommunitySchema, setStatusSchema } from './schemas';

/**
 * Gestión de comunidades: solo desde el panel central. El propietario de la
 * plataforma puede todo; una cuenta normal (rol "user") solo puede crear
 * comunidades si el propietario le ha activado el permiso, y gestionar las que
 * administra. Estas comprobaciones se hacen aquí, aunque el middleware ya
 * resuelva la sesión, porque este es el punto que protege la creación y la
 * suspensión de foros.
 */
function requirePanelAuth(req: AuthRequest): AuthContext {
  if (req.tenant?.kind !== 'platform') {
    throw new ForbiddenException('Esta operación solo está disponible en el panel central');
  }
  if (!req.auth) throw new UnauthorizedException('No has iniciado sesión');
  if (req.auth.role !== 'owner' && req.auth.role !== 'user') {
    throw new ForbiddenException('Esta operación solo está disponible en el panel central');
  }
  return req.auth;
}

function requireOwner(req: AuthRequest): AuthContext {
  const auth = requirePanelAuth(req);
  if (auth.role !== 'owner') throw new ForbiddenException('Solo el propietario de la plataforma puede hacer esto');
  return auth;
}

@Controller('communities')
export class CommunitiesController {
  constructor(@Inject(CommunitiesService) private readonly communities: CommunitiesService) {}

  @Post()
  async create(@Req() req: AuthRequest, @Body() body: unknown) {
    const auth = requirePanelAuth(req);
    if (!auth.canCreateCommunities) {
      throw new ForbiddenException('No tienes permiso para crear comunidades');
    }
    const input = parse(createCommunitySchema, body);
    // Solo el propietario puede nombrar administrador a otra cuenta: quien crea
    // una comunidad con el permiso de creador es siempre su administrador.
    if (auth.role !== 'owner' && input.adminEmail !== undefined && input.adminEmail !== auth.email.toLowerCase()) {
      throw new ForbiddenException('Solo el propietario de la plataforma puede asignar otro administrador');
    }
    const community = await this.communities.create(input, auth.email);
    return { community };
  }

  /** Todas las comunidades de la plataforma: solo el propietario. */
  @Get()
  async list(@Req() req: AuthRequest) {
    requireOwner(req);
    return { communities: await this.communities.list() };
  }

  /** Las comunidades que administra quien hace la petición. */
  @Get('mine')
  async listMine(@Req() req: AuthRequest) {
    const auth = requirePanelAuth(req);
    return { communities: await this.communities.listAdministeredBy(auth.userId) };
  }

  @Patch(':id/status')
  async setStatus(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    const auth = requirePanelAuth(req);
    const { status } = parse(setStatusSchema, body);
    const community = await this.communities.setStatus(parse(communityIdSchema, id), status, {
      userId: auth.userId,
      isOwner: auth.role === 'owner',
    });
    return { community };
  }
}
