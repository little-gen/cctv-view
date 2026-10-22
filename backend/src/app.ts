import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { config } from './config.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { attachmentsRouter } from './modules/attachments/attachments.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { camerasRouter } from './modules/cameras/cameras.routes.js';
import { exportsRouter } from './modules/exports/exports.routes.js';
import { nvrsRouter } from './modules/nvrs/nvrs.routes.js';
import { plansRouter } from './modules/plans/plans.routes.js';
import { projectsRouter } from './modules/projects/projects.routes.js';
import { searchRouter } from './modules/search/search.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

const OPENAPI_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../openapi.yaml');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  // La API solo devuelve JSON y ficheros: CSP mínima, sin estilos ni scripts (hallazgo L-03)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
      },
    }),
  );
  // Respuestas de la API nunca en caché (datos autenticados; hallazgo M-04).
  // Las teselas del plano lo sustituyen por una caché privada e inmutable.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
  });
  app.set('etag', false);
  app.use(cors({ origin: config.corsOrigin, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '1mb' }));
  if (config.env !== 'test') app.use(morgan('dev'));

  // Documentación de la API: desactivada en producción salvo API_DOCS=true (hallazgo M-01)
  if (config.apiDocs) {
    const spec = YAML.parse(fs.readFileSync(OPENAPI_FILE, 'utf8'));
    app.get('/api/openapi.json', (_req, res) => res.json(spec));
    // Swagger UI necesita estilos e imágenes propios: CSP por defecto de helmet solo aquí
    app.use('/api/docs', helmet.contentSecurityPolicy(), swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'PlanosCamaras API' }));
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Público
  app.use('/api/auth', authRouter);

  // Protegido
  const api = express.Router();
  api.use(authenticate);
  api.use('/users', usersRouter);
  api.use('/projects', projectsRouter);
  api.use('/audit', auditRouter);
  api.use('/search', searchRouter);
  api.use(plansRouter);
  api.use(nvrsRouter);
  api.use(camerasRouter);
  api.use(attachmentsRouter);
  api.use(exportsRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
