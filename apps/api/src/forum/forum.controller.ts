import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthContext, AuthRequest } from '../auth/auth';
import { parse } from '../common/parse';
import { ForumService } from './forum.service';
import {
  createCategorySchema,
  createForumSchema,
  createPostSchema,
  createTopicSchema,
  idSchema,
  pageSchema,
  updateCategorySchema,
  updateForumSchema,
} from './schemas';

/**
 * Foro de una comunidad. No hay invitados: todo exige haber iniciado sesión y ser miembro
 * de la comunidad a la que va dirigida la petición.
 *
 * - Miembros: leer, crear temas y responder.
 * - Administradores: además, gestionar categorías y foros.
 *
 * La comunidad sale siempre de req.tenant (resuelta por el host), nunca del cuerpo ni de la
 * URL, y el autor de un tema o mensaje es siempre quien hace la petición.
 */
interface CommunityContext {
  communityId: string;
  auth: AuthContext;
}

function requireMember(req: AuthRequest): CommunityContext {
  if (req.tenant?.kind !== 'community') {
    throw new ForbiddenException('Esta operación solo está disponible dentro de una comunidad');
  }
  if (!req.auth) throw new UnauthorizedException('No has iniciado sesión');
  if (req.auth.role !== 'admin' && req.auth.role !== 'member') {
    throw new ForbiddenException('No perteneces a esta comunidad');
  }
  return { communityId: req.tenant.community.id, auth: req.auth };
}

function requireAdmin(req: AuthRequest): CommunityContext {
  const context = requireMember(req);
  if (context.auth.role !== 'admin') {
    throw new ForbiddenException('Solo los administradores de la comunidad pueden hacer esto');
  }
  return context;
}

@Controller()
export class ForumController {
  constructor(@Inject(ForumService) private readonly forum: ForumService) {}

  // ---------- Categorías ----------

  @Get('categories')
  async listCategories(@Req() req: AuthRequest) {
    const { communityId } = requireMember(req);
    return { categories: await this.forum.listCategories(communityId) };
  }

  @Post('categories')
  async createCategory(@Req() req: AuthRequest, @Body() body: unknown) {
    const { communityId } = requireAdmin(req);
    return { category: await this.forum.createCategory(communityId, parse(createCategorySchema, body)) };
  }

  @Patch('categories/:id')
  async updateCategory(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    const { communityId } = requireAdmin(req);
    const category = await this.forum.updateCategory(
      communityId,
      parse(idSchema, id),
      parse(updateCategorySchema, body),
    );
    return { category };
  }

  @Delete('categories/:id')
  @HttpCode(204)
  async deleteCategory(@Req() req: AuthRequest, @Param('id') id: string): Promise<void> {
    const { communityId } = requireAdmin(req);
    await this.forum.deleteCategory(communityId, parse(idSchema, id));
  }

  // ---------- Foros y subforos ----------

  @Get('forums')
  async listForums(@Req() req: AuthRequest) {
    const { communityId } = requireMember(req);
    return { forums: await this.forum.listForums(communityId) };
  }

  @Post('forums')
  async createForum(@Req() req: AuthRequest, @Body() body: unknown) {
    const { communityId } = requireAdmin(req);
    return { forum: await this.forum.createForum(communityId, parse(createForumSchema, body)) };
  }

  @Patch('forums/:id')
  async updateForum(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    const { communityId } = requireAdmin(req);
    const forum = await this.forum.updateForum(communityId, parse(idSchema, id), parse(updateForumSchema, body));
    return { forum };
  }

  @Delete('forums/:id')
  @HttpCode(204)
  async deleteForum(@Req() req: AuthRequest, @Param('id') id: string): Promise<void> {
    const { communityId } = requireAdmin(req);
    await this.forum.deleteForum(communityId, parse(idSchema, id));
  }

  // ---------- Temas ----------

  @Get('forums/:id/topics')
  async listTopics(@Req() req: AuthRequest, @Param('id') id: string, @Query() query: unknown) {
    const { communityId } = requireMember(req);
    const topics = await this.forum.listTopics(communityId, parse(idSchema, id), parse(pageSchema, query));
    return { topics };
  }

  @Post('forums/:id/topics')
  async createTopic(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    const { communityId, auth } = requireMember(req);
    return this.forum.createTopic(communityId, parse(idSchema, id), auth.userId, parse(createTopicSchema, body));
  }

  @Get('topics/:id')
  async getTopic(@Req() req: AuthRequest, @Param('id') id: string) {
    const { communityId } = requireMember(req);
    return { topic: await this.forum.getTopic(communityId, parse(idSchema, id)) };
  }

  // ---------- Mensajes ----------

  @Get('topics/:id/posts')
  async listPosts(@Req() req: AuthRequest, @Param('id') id: string, @Query() query: unknown) {
    const { communityId } = requireMember(req);
    const posts = await this.forum.listPosts(communityId, parse(idSchema, id), parse(pageSchema, query));
    return { posts };
  }

  @Post('topics/:id/posts')
  async createPost(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    const { communityId, auth } = requireMember(req);
    const post = await this.forum.createPost(communityId, parse(idSchema, id), auth.userId, parse(createPostSchema, body));
    return { post };
  }
}
