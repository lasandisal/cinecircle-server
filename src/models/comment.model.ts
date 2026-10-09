import mongoose, { Schema, Document } from 'mongoose';
import { IComment } from '../types';

export interface ICommentDocument extends Omit<IComment, '_id'>, Document {}

const CommentSchema = new Schema<ICommentDocument>(
  {
    title: { type: Schema.Types.ObjectId, ref: 'Title', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    reported: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Comment = mongoose.model<ICommentDocument>('Comment', CommentSchema);
