import mongoose, { Schema, Document } from 'mongoose';

export interface IOtpDocument extends Document {
  email: string;
  otpHash: string;
  type: 'register' | 'login' | 'reset';
  verified: boolean;
  attempts: number;
  createdAt: Date;
}

const OtpSchema = new Schema<IOtpDocument>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    otpHash: { type: String, required: true },
    type: { type: String, enum: ['register', 'login', 'reset'], default: 'register' },
    verified: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, expires: 600 }, // 10 minutes TTL
  },
  { timestamps: false }
);

export const Otp = mongoose.model<IOtpDocument>('Otp', OtpSchema);
