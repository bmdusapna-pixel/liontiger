import User from '../models/User.js';
import Bet from '../models/Bet.js';
import RoundResult from '../models/RoundResult.js';
import gameService from '../services/gameService.js';

export const getWallet = async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

export const register = async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  try {
    let user = await User.findOne({ userId });
    if (user) return res.status(400).json({ error: "User already exists" });
    user = new User({ userId, balance: 1000 });
    await user.save();
    res.json({ status: "ok", balance: user.balance });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "User already exists" });
    res.status(500).json({ error: "Server error" });
  }
};

export const getCurrentRound = (req, res) => {
  const round = gameService.getCurrentRound();
  res.json({
    roundId: round.roundId,
    time: round.time,
    status: round.status,
    totals: round.totals
  });
};

export const getHistory = async (req, res) => {
  const { userId } = req.params;
  try {
    const bets = await Bet.find({ userId }).sort({ timestamp: -1 }).limit(50);
    res.json(bets.map(bet => ({
      roundId: bet.roundId,
      side: bet.side,
      amount: bet.amount,
      won: bet.won,
      payout: bet.payout
    })));
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

export const placeBet = async (req, res) => {
  const { userId, roundId, side, amount } = req.body;
  const parsedAmount = Math.floor(parseInt(amount));

  if (!parsedAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ success: false, message: "Invalid amount" });
  }
  
  if (parsedAmount < 10) return res.status(400).json({ success: false, message: "Minimum bet ₹10" });
  if (parsedAmount > 50000) return res.status(400).json({ success: false, message: "Maximum bet ₹50,000" });

  const currentRound = gameService.getCurrentRound();
  if (!["Lion", "Tiger", "Draw"].includes(side)) {
    return res.status(400).json({ success: false, message: "Invalid side" });
  }
  if (roundId !== currentRound.roundId) {
    return res.status(400).json({ success: false, message: "Round expired" });
  }
  if (currentRound.status !== "betting" || currentRound.time <= 3) {
    return res.status(400).json({ success: false, message: "Betting is closed" });
  }

  const existingBet = currentRound.bets.find(b => b.userId === userId);
  if (existingBet) {
    return res.status(400).json({ success: false, message: "Already bet this round" });
  }

  try {
    const user = await User.findOneAndUpdate(
      { userId, balance: { $gte: parsedAmount } },
      { $inc: { balance: -parsedAmount } },
      { new: true }
    );

    if (!user) {
      return res.status(400).json({ success: false, message: "Insufficient balance or user not found" });
    }

    const bet = { userId, roundId, side, amount: parsedAmount, timestamp: Date.now() };

    await Bet.create({ ...bet, won: false, payout: 0, status: "pending" });

    try {
      gameService.addBetToCache(bet);
    } catch (cacheErr) {
      await User.findOneAndUpdate({ userId }, { $inc: { balance: parsedAmount } });
      await Bet.deleteOne({ userId, roundId });
      return res.status(400).json({ success: false, message: cacheErr.message });
    }

    res.json({ success: true, message: "Bet placed!", balance: user.balance });

  } catch (err) {
    console.error("Bet error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getRecentResults = async (req, res) => {
  try {
    const results = await RoundResult.find().sort({ timestamp: -1 }).limit(50);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

export const getRoundStats = (req, res) => {
  const round = gameService.getCurrentRound();
  res.json({ roundId: round.roundId, totals: round.totals });
};