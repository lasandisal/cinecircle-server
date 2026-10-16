import mongoose, { Schema, Document } from 'mongoose';
import { ISeasonEpisode } from '../types';

export interface ISeasonEpisodeDocument extends Omit<ISeasonEpisode, '_id'>, Document {}

const SeasonEpisodeSchema = new Schema<ISeasonEpisodeDocument>(
  {
    title: { type: Schema.Types.ObjectId, ref: 'Title', required: true, index: true },
    seasonNumber: { type: Number, required: true },
    // Intentionally no default: a brand-new season must be immediately eligible
    // for its first TMDB episode sync rather than looking "fresh" for 30 minutes.
    sourceUpdatedAt: { type: Date },
    episodes: [
      {
        episodeNumber: { type: Number, required: true },
        name: { type: String, required: true },
        summary: { type: String, default: '' },
        runtimeMinutes: { type: Number, default: 0 },
        stillUrl: { type: String, default: '' },
        airDate: { type: String, default: '' },
        voteAverage: { type: Number, default: 0 },
        featuredSong: {
          songName: { type: String },
          artist: { type: String },
          sceneRef: { type: String },
          previewUrl: { type: String },
          albumArtUrl: { type: String },
          spotifyUrl: { type: String },
        },
      },
    ],
  },
  { timestamps: true }
);

export const SeasonEpisode = mongoose.model<ISeasonEpisodeDocument>('SeasonEpisode', SeasonEpisodeSchema);
