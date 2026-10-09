import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import titleRoutes from './title.routes';
import recommendationRoutes from './recommendation.routes';
import sessionRoutes from './session.routes';
import watchlistRoutes from './watchlist.routes';
import curatorRoutes from './curator.routes';

const apiRouter = Router();

apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CineCircle Backend API',
    timestamp: new Date().toISOString(),
  });
});

apiRouter.use('/auth', authRoutes);
apiRouter.use('/users', userRoutes);
apiRouter.use('/titles', titleRoutes);
apiRouter.use('/recommendations', recommendationRoutes);
apiRouter.use('/sessions', sessionRoutes);
apiRouter.use('/watchlist', watchlistRoutes);
apiRouter.use('/curator', curatorRoutes);

export default apiRouter;
