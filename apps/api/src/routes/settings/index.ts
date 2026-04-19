import type { FastifyInstance } from 'fastify';
import { usersSettingsRoutes } from './users.js';
import { permissionsSettingsRoutes } from './permissions.js';

export async function settingsRoutes(app: FastifyInstance) {
  await app.register(usersSettingsRoutes, { prefix: '/users' });
  await app.register(permissionsSettingsRoutes, { prefix: '/permissions' });
}
