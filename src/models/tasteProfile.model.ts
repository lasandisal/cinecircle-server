import mongoose, { Schema, Document } from 'mongoose';
import { ITasteProfile } from '../types';

export interface ITasteProfileDocument extends Omit<ITasteProfile, '_id'>, Document {}

const TasteProfileSchema = new Schema<ITasteProfileDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    favoriteGenres: { type: [String], default: [] },
    favoriteTitles: [{ type: Schema.Types.ObjectId, ref: 'Title' }],
    exclusions: { type: [String], default: [] },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export const TasteProfile = mongoose.model<ITasteProfileDocument>('TasteProfile', TasteProfileSchema);
