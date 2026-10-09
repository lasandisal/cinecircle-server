import express, { Application } from 'express';
import cors from 'cors';
import apiRouter from './routes';
import { errorHandler } from './middleware/error.middleware';
import { ENV } from './config/env';

const app: Application = express();

// Middleware
app.use(cors({ origin: ENV.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root Route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to CineCircle API',
    docs: '/api/health',
  });
});

// API Routes
app.use('/api', apiRouter);

// Global Error Handler
app.use(errorHandler);

export default app;
