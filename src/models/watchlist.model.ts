import mongoose, { Schema, Document } from 'mongoose';
import { IWatchlist } from '../types';

export interface IWatchlistDocument extends Omit<IWatchlist, '_id'>, Document {}

const WatchlistSchema = new Schema<IWatchlistDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: Schema.Types.ObjectId, ref: 'Title', required: true },
    watched: { type: Boolean, default: false },
    starRating: { type: Number, min: 1, max: 5 },
    addedAt: { type: Date, default: Date.now },
    watchedAt: { type: Date },
  },
  { timestamps: false }
);

export const Watchlist = mongoose.model<IWatchlistDocument>('Watchlist', WatchlistSchema);
