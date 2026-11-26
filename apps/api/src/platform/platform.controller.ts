import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthContext, AuthRequest } from '../auth/auth';
import { parse } from '../common/parse';
import { PlatformService } from './platform.service';
import { updateUserSchema, userIdSchema } from './schemas';

/** Solo el propietario de la plataforma, y solo desde el panel central. */
function requireOwner(req: AuthRequest): AuthContext {
  if (req.tenant?.kind !== 'platform') {
    throw new ForbiddenException('Esta operación solo está disponible en el panel central');
  }
  if (!req.auth) throw new UnauthorizedException('No has iniciado sesión');
  if (req.auth.role !== 'owner') throw new ForbiddenException('Solo el propietario de la plataforma puede hacer esto');
  return req.auth;
}

@Controller('platform/users')
export class PlatformController {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  @Get()
  async list(@Req() req: AuthRequest) {
    requireOwner(req);
    return { users: await this.platform.listUsers() };
  }

  @Patch(':id')
  async update(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    requireOwner(req);
    const { canCreateCommunities } = parse(updateUserSchema, body);
    const user = await this.platform.setCanCreateCommunities(parse(userIdSchema, id), canCreateCommunities);
    return { user };
  }
}
