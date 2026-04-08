import User from '../models/User.js';
import Bet from '../models/Bet.js';
import RoundResult from '../models/RoundResult.js';
import gameService from '../services/gameService.js';

const GAME_TAG = "lion_tiger"; // ✅ Ek jagah define

export const getWallet = async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await User.findOne({ firebaseUid: userId }).select('coin uniqueId name');
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ coin: user.coin });
  } catch (err) {
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
    const bets = await Bet.find({ userId, game: GAME_TAG }) // ✅ game filter
      .sort({ timestamp: -1 })
      .limit(50);
    res.json(bets.map(bet => ({
      roundId: bet.roundId,
      side: bet.side,
      amount: bet.amount,
      won: bet.won,
      payout: bet.payout,
      status: bet.status,
      timestamp: bet.timestamp,
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
  if (parsedAmount < 10) {
    return res.status(400).json({ success: false, message: "Minimum bet 10 coins" });
  }
  if (parsedAmount > 10000000) {
    return res.status(400).json({ success: false, message: "Maximum bet  1,00,00,000 coins" });
  }

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

  try {
    const user = await User.findOneAndUpdate(
      { firebaseUid: userId, coin: { $gte: parsedAmount }, isBlock: false },
      { $inc: { coin: -parsedAmount } },
      { new: true }
    );

    if (!user) {
      return res.status(400).json({ success: false, message: "Insufficient coins or user not found" });
    }

    const createdBet = await Bet.create({
      game: GAME_TAG,
      userId,
      roundId,
      side,
      amount: parsedAmount,
      won: false,
      payout: 0,
      status: "pending",
      timestamp: Date.now()
    });

    try {
      gameService.addBetToCache(createdBet);
    } catch (cacheErr) {
      await User.findOneAndUpdate({ firebaseUid: userId }, { $inc: { coin: parsedAmount } });
      await Bet.deleteOne({ _id: createdBet._id });
      return res.status(400).json({ success: false, message: cacheErr.message });
    }

    res.json({ success: true, message: "Bet placed!", coin: user.coin, side, amount: parsedAmount });

  } catch (err) {
    console.error("Bet error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getRecentResults = async (req, res) => {
  try {
    const results = await RoundResult.find({ game: "lion_tiger" }) // ✅
      .sort({ timestamp: -1 })
      .limit(50);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

export const getRoundStats = (req, res) => {
  const round = gameService.getCurrentRound();
  res.json({ roundId: round.roundId, totals: round.totals });
};