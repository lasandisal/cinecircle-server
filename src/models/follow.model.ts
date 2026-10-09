import mongoose, { Schema, Document } from 'mongoose';
import { IFollow } from '../types';

export interface IFollowDocument extends Omit<IFollow, '_id'>, Document {}

const FollowSchema = new Schema<IFollowDocument>(
  {
    follower: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    followedType: { type: String, enum: ['user', 'title'], required: true },
    followedUser: { type: Schema.Types.ObjectId, ref: 'User' },
    followedTitle: { type: Schema.Types.ObjectId, ref: 'Title' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

FollowSchema.index({ follower: 1, followedType: 1, followedUser: 1, followedTitle: 1 }, { unique: true });

export const Follow = mongoose.model<IFollowDocument>('Follow', FollowSchema);
