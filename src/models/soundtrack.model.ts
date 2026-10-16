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
    previewUrl: { type: String },
    albumArtUrl: { type: String },
    spotifyUrl: { type: String },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    source: { type: String, enum: ['curated', 'auto', 'user'], default: 'user' },
    sourceUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Soundtrack = mongoose.model<ISoundtrackDocument>('Soundtrack', SoundtrackSchema);
