import mongoose, { Schema, Document } from 'mongoose';
import { IComment } from '../types';

export interface ICommentDocument extends Omit<IComment, '_id'>, Document {}

const CommentSchema = new Schema<ICommentDocument>(
  {
    title: { type: Schema.Types.ObjectId, ref: 'Title', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    rating: { type: Number },
    likesCount: { type: Number, default: 0 },
    parentId: { type: Schema.Types.ObjectId, ref: 'Comment', default: null },
    reactions: [
      {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        emoji: {
          type: String,
          enum: ['like', 'love', 'fire', 'mindblown', 'popcorn', 'sad'],
          required: true,
        },
      },
    ],
    poll: {
      question: { type: String },
      options: [
        {
          optionText: { type: String, required: true },
          votes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
        },
      ],
    },
    containsSpoilers: { type: Boolean, default: false },
    reported: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Comment = mongoose.model<ICommentDocument>('Comment', CommentSchema);
