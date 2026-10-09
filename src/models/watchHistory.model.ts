import mongoose, { Schema, Document } from 'mongoose';
import { IWatchHistory } from '../types';

export interface IWatchHistoryDocument extends Omit<IWatchHistory, '_id'>, Document {}

const WatchHistorySchema = new Schema<IWatchHistoryDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: Schema.Types.ObjectId, ref: 'Title', required: true },
    action: {
      type: String,
      enum: ['watched', 'rated', 'skipped', 'picked'],
      required: true,
    },
    rating: { type: Number, min: 1, max: 5 },
    moodAtTime: { type: String },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

export const WatchHistory = mongoose.model<IWatchHistoryDocument>('WatchHistory', WatchHistorySchema);
