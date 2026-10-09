import mongoose, { Schema, Document } from 'mongoose';
import { ISoundtrack } from '../types';

export interface ISoundtrackDocument extends Omit<ISoundtrack, '_id'>, Document {}

const SoundtrackSchema = new Schema<ISoundtrackDocument>(
  {
    title: { type: Schema.Types.ObjectId, ref: 'Title', required: true, index: true },
    songName: { type: String, required: true },
    artist: { type: String, required: true },
    episodeRef: { type: String },
    popularityRank: { type: Number, default: 0 },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export const Soundtrack = mongoose.model<ISoundtrackDocument>('Soundtrack', SoundtrackSchema);
