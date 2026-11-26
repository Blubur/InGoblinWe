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
 * Gestión de comunidades: solo desde el panel central y solo para el propietario
 * de la plataforma. El middleware de autenticación ya garantiza que una sesión
 * del panel central solo la tiene el propietario, pero aquí se comprueba de nuevo
 * porque este es el punto que protege la creación y suspensión de foros.
 */
function requireOwner(req: AuthRequest): AuthContext {
  if (req.tenant?.kind !== 'platform') {
    throw new ForbiddenException('Esta operación solo está disponible en el panel central');
  }
  if (!req.auth) throw new UnauthorizedException('No has iniciado sesión');
  if (req.auth.role !== 'owner') throw new ForbiddenException('Solo el propietario de la plataforma puede hacer esto');
  return req.auth;
}

@Controller('communities')
export class CommunitiesController {
  constructor(@Inject(CommunitiesService) private readonly communities: CommunitiesService) {}

  @Post()
  async create(@Req() req: AuthRequest, @Body() body: unknown) {
    const owner = requireOwner(req);
    const community = await this.communities.create(parse(createCommunitySchema, body), owner.email);
    return { community };
  }

  @Get()
  async list(@Req() req: AuthRequest) {
    requireOwner(req);
    return { communities: await this.communities.list() };
  }

  @Patch(':id/status')
  async setStatus(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    requireOwner(req);
    const { status } = parse(setStatusSchema, body);
    const community = await this.communities.setStatus(parse(communityIdSchema, id), status);
    return { community };
  }
}
