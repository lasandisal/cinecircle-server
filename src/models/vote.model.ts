import mongoose, { Schema, Document } from 'mongoose';
import { IVote } from '../types';

export interface IVoteDocument extends Omit<IVote, '_id'>, Document {}

const VoteSchema = new Schema<IVoteDocument>(
  {
    session: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: Schema.Types.ObjectId, ref: 'Title', required: true },
    reaction: { type: String, enum: ['yes', 'no'], required: true },
    strength: { type: Number, min: 1, max: 5, required: true },
  },
  { timestamps: true }
);

VoteSchema.index({ session: 1, user: 1, title: 1 }, { unique: true });

export const Vote = mongoose.model<IVoteDocument>('Vote', VoteSchema);
