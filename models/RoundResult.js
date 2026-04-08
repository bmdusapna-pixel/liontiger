import mongoose from 'mongoose';

const roundResultSchema = new mongoose.Schema({
  game: { type: String, default: "lion_tiger", index: true },
  roundId: { type: String, unique: true, required: true },
  winner: { type: String, enum: ["Lion", "Tiger", "Draw"], required: true },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

const RoundResult = mongoose.model('RoundResult', roundResultSchema);
export default RoundResult;