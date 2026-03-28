import mongoose from 'mongoose';

const dailyStatSchema = new mongoose.Schema({
  date: { type: String, unique: true, required: true },
  totalHouseProfit: { type: Number, default: 0 },
  totalHouseLoss: { type: Number, default: 0 },
  lastReset: { type: Date, default: Date.now }
}, { timestamps: true });

const DailyStat = mongoose.model('DailyStat', dailyStatSchema);
export default DailyStat;
