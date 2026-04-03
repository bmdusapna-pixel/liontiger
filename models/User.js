import mongoose from 'mongoose';

// WePlayChat ke same 'users' collection ko point karta hai
const userSchema = new mongoose.Schema({}, {
  collection: 'users',
  strict: false,
  versionKey: false,
  timestamps: true,
});

const User = mongoose.model('User', userSchema);
export default User;