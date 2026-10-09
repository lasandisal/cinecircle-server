import mongoose, { Schema, Document } from 'mongoose';
import { ISession } from '../types';

export interface ISessionDocument extends Omit<ISession, '_id'>, Document {}

const SessionSchema = new Schema<ISessionDocument>(
  {
    name: { type: String, default: 'Watch Decision Room' },
    host: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    joinCode: { type: String, required: true, unique: true, index: true },
    participants: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    constraints: {
      maxRuntime: { type: Number },
      moodFilter: { type: String },
    },
    shortlist: [{ type: Schema.Types.ObjectId, ref: 'Title' }],
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    finalPick: { type: Schema.Types.ObjectId, ref: 'Title' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export const Session = mongoose.model<ISessionDocument>('Session', SessionSchema);
