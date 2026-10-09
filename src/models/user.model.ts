import mongoose, { Schema, Document } from 'mongoose';
import { IUser } from '../types';

export interface IUserDocument extends Omit<IUser, '_id'>, Document {}

const UserSchema = new Schema<IUserDocument>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    tasteProfile: { type: Schema.Types.ObjectId, ref: 'TasteProfile' },
    subscribedServices: { type: [String], default: [] },
    fatigueCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUserDocument>('User', UserSchema);
