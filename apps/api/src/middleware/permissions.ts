import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Permission } from '@inmob/shared';
import { Tenant, User } from '@inmob/database';
import { resolvePermissions } from '../utils/permissions.js';

export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    if (!auth) {
      return reply.status(401).send({ error: 'No autenticado', code: 'UNAUTHENTICATED' });
    }

    const em = request.orm.em.fork();

    const user = await em.findOne(User, { id: auth.userId });

    if (!user || !user.isActive) {
      return reply.status(403).send({ error: 'Usuario no encontrado o inactivo', code: 'USER_INACTIVE' });
    }

    const tenant = await em.findOne(Tenant, {});
    const effective = resolvePermissions(user, tenant?.permissionConfig);

    if (!effective.has(permission)) {
      return reply.status(403).send({
        error: `Sin permiso: ${permission}`,
        code: 'FORBIDDEN',
        required: permission,
        userRoles: user.roles,
      });
    }

    request.currentUser = user;
  };
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    if (!auth) {
      return reply.status(401).send({ error: 'No autenticado', code: 'UNAUTHENTICATED' });
    }

    const em = request.orm.em.fork();
    const user = await em.findOne(User, { id: auth.userId });

    if (!user || !user.isActive) {
      return reply.status(403).send({ error: 'Usuario inactivo', code: 'USER_INACTIVE' });
    }

    const hasRole = user.roles.some((r) => roles.includes(r));
    if (!hasRole) {
      return reply.status(403).send({
        error: `Requiere uno de los roles: ${roles.join(', ')}`,
        code: 'WRONG_ROLE',
      });
    }

    request.currentUser = user;
  };
}
