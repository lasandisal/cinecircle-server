import mongoose from 'mongoose';
import { ENV } from './env';

let isConnecting = false;

export const connectDB = async (): Promise<typeof mongoose> => {
  // If already connected, reuse existing connection
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  // Prevent multiple simultaneous connection attempts
  if (isConnecting) {
    while (isConnecting) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return mongoose;
  }

  isConnecting = true;
  try {
    const conn = await mongoose.connect(ENV.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log(`[Database] MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error('[Database] MongoDB connection error:', error);
    if (!process.env.VERCEL) {
      process.exit(1);
    }
    throw error;
  } finally {
    isConnecting = false;
  }
};

