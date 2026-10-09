import mongoose, { Schema, Document } from 'mongoose';
import { ITitle } from '../types';

export interface ITitleDocument extends Omit<ITitle, '_id'>, Document {}

const TitleSchema = new Schema<ITitleDocument>(
  {
    tmdbId: { type: Number, required: true, index: true },
    name: { type: String, required: true, index: true },
    type: { type: String, enum: ['tv', 'film'], required: true, index: true },
    genres: { type: [String], default: [] },
    synopsis: { type: String, default: '' },
    runtimeMinutes: { type: Number, default: 0 },
    posterUrl: { type: String, default: '' },
    backdropUrl: { type: String, default: '' },
    releaseYear: { type: Number },
    voteAverage: { type: Number, default: 0 },
    moodTags: { type: [String], default: [] },
    cast: [
      {
        actorName: { type: String, required: true },
        characterName: { type: String, required: true },
        photoUrl: { type: String },
        bio: { type: String },
      },
    ],
  },
  { timestamps: true }
);

TitleSchema.index({ tmdbId: 1, type: 1 }, { unique: true });

export const Title = mongoose.model<ITitleDocument>('Title', TitleSchema);
