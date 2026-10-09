import mongoose, { Schema, Document } from 'mongoose';
import { IWatchProvider } from '../types';

export interface IWatchProviderDocument extends Omit<IWatchProvider, '_id'>, Document {}

const WatchProviderSchema = new Schema<IWatchProviderDocument>(
  {
    title: { type: Schema.Types.ObjectId, ref: 'Title', required: true, index: true },
    service: { type: String, required: true },
    region: { type: String, required: true },
    type: { type: String, enum: ['subscription', 'rental', 'purchase'], required: true },
    sourceUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export const WatchProvider = mongoose.model<IWatchProviderDocument>('WatchProvider', WatchProviderSchema);
