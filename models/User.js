import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true, required: true },
  balance: { type: Number, default: 1000 },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
export default User;
