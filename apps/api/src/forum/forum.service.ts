import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  createCategory,
  createForum,
  createPost,
  createTopic,
  deleteCategory,
  deleteForum,
  findForum,
  findTopic,
  listCategories,
  listForums,
  listPosts,
  listTopics,
  updateCategory,
  updateForum,
  type Category,
  type Forum,
  type PageOptions,
  type Pool,
  type Post,
  type Topic,
} from '@goblins/database';
import type {
  CreateCategoryInput,
  CreateForumInput,
  CreatePostInput,
  CreateTopicInput,
  UpdateCategoryInput,
  UpdateForumInput,
} from './schemas';

/**
 * Lógica del foro. Recibe siempre communityId (el que resolvió el middleware a partir del
 * host, nunca uno enviado por el cliente) y traduce los motivos de la capa de datos a
 * errores HTTP. Quién puede llamar a cada operación lo decide el controlador.
 */
export class ForumService {
  constructor(private readonly pool: Pool) {}

  listCategories(communityId: string): Promise<Category[]> {
    return listCategories(this.pool, communityId);
  }

  createCategory(communityId: string, input: CreateCategoryInput): Promise<Category> {
    return createCategory(this.pool, communityId, input);
  }

  async updateCategory(communityId: string, categoryId: string, changes: UpdateCategoryInput): Promise<Category> {
    const category = await updateCategory(this.pool, communityId, categoryId, changes);
    if (!category) throw new NotFoundException('La categoría no existe');
    return category;
  }

  async deleteCategory(communityId: string, categoryId: string): Promise<void> {
    const result = await deleteCategory(this.pool, communityId, categoryId);
    if (result === 'not_found') throw new NotFoundException('La categoría no existe');
    if (result === 'not_empty') throw new ConflictException('La categoría tiene foros: muévelos o bórralos antes');
  }

  listForums(communityId: string): Promise<Forum[]> {
    return listForums(this.pool, communityId);
  }

  async createForum(communityId: string, input: CreateForumInput): Promise<Forum> {
    const result = await createForum(this.pool, communityId, input);
    if (!result.ok) {
      throw new NotFoundException(
        'La categoría o el foro padre no existe, o el foro padre está en otra categoría',
      );
    }
    return result.forum;
  }

  async updateForum(communityId: string, forumId: string, changes: UpdateForumInput): Promise<Forum> {
    const forum = await updateForum(this.pool, communityId, forumId, changes);
    if (!forum) throw new NotFoundException('El foro no existe');
    return forum;
  }

  async deleteForum(communityId: string, forumId: string): Promise<void> {
    const result = await deleteForum(this.pool, communityId, forumId);
    if (result === 'not_found') throw new NotFoundException('El foro no existe');
    if (result === 'not_empty') throw new ConflictException('El foro tiene subforos o temas: vacíalo antes de borrarlo');
  }

  async listTopics(communityId: string, forumId: string, page: PageOptions): Promise<Topic[]> {
    if (!(await findForum(this.pool, communityId, forumId))) throw new NotFoundException('El foro no existe');
    return listTopics(this.pool, communityId, forumId, page);
  }

  async createTopic(
    communityId: string,
    forumId: string,
    authorId: string,
    input: CreateTopicInput,
  ): Promise<{ topic: Topic; post: Post }> {
    const result = await createTopic(this.pool, communityId, { forumId, authorId, ...input });
    if (result.ok) return { topic: result.topic, post: result.post };
    if (result.reason === 'forum_not_found') throw new NotFoundException('El foro no existe');
    if (result.reason === 'forum_locked') throw new ForbiddenException('El foro está bloqueado');
    throw new ForbiddenException('No perteneces a esta comunidad');
  }

  async getTopic(communityId: string, topicId: string): Promise<Topic> {
    const topic = await findTopic(this.pool, communityId, topicId);
    if (!topic) throw new NotFoundException('El tema no existe');
    return topic;
  }

  async listPosts(communityId: string, topicId: string, page: PageOptions): Promise<Post[]> {
    if (!(await findTopic(this.pool, communityId, topicId))) throw new NotFoundException('El tema no existe');
    return listPosts(this.pool, communityId, topicId, page);
  }

  async createPost(communityId: string, topicId: string, authorId: string, input: CreatePostInput): Promise<Post> {
    const result = await createPost(this.pool, communityId, { topicId, authorId, ...input });
    if (result.ok) return result.post;
    if (result.reason === 'topic_not_found') throw new NotFoundException('El tema no existe');
    if (result.reason === 'topic_locked') throw new ForbiddenException('El tema está cerrado');
    if (result.reason === 'forum_locked') throw new ForbiddenException('El foro está bloqueado');
    throw new ForbiddenException('No perteneces a esta comunidad');
  }
}
