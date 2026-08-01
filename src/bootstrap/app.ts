import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { env } from '../config/env.js';
import { errorHandler } from '../core/http/errorHandler.js';
import { notFoundHandler } from '../core/http/notFoundHandler.js';
import { apiRouter } from './registerRoutes.js';
import { createPublicAssetStaticMiddleware, publicAssetDirectories } from '../integrations/storage/index.js';

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
for (const directory of publicAssetDirectories) {
  app.use(`/storage/${directory}`, createPublicAssetStaticMiddleware(directory));
}

app.use('/api/v1', apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
