import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import User from '../models/User.js';
import Bet from '../models/Bet.js';
import RoundResult from '../models/RoundResult.js';
import DailyStat from '../models/DailyStat.js';

class GameService {
  constructor() {
    this.currentRound = {
      roundId: uuidv4(),
      time: 15,
      status: "betting",
      bets: [],
      totals: { Lion: 0, Tiger: 0, Draw: 0 }
    };
    this.io = null;
    this.userIdToSocket = new Map();   // firebaseUid → socketId
    this.userLastBets = new Map();     // firebaseUid → bet history

    this.EXPOSURE_LIMIT_PER_ROUND = 1500000; // 15 Lakh (Kyunki 1L bet on Draw = 9L exposure)
    this.DAILY_MAX_LOSS_LIMIT = 2000000;    // 20 Lakh Max Daily Loss
    this.HOUSE_EDGE_THRESHOLD = 10000;      // 10,000 tak Fair, usse upar House Optimization shuru

    this.dailyLoss = 0;
    this.dailyProfit = 0;
    this.currentDate = new Date().toISOString().split('T')[0];
    this.initDailyStats();
  }

  async initDailyStats() {
    const today = new Date().toISOString().split('T')[0];
    this.currentDate = today;
    let stats = await DailyStat.findOne({ date: today });
    if (!stats) {
      stats = await DailyStat.create({ date: today });
    }
    this.dailyLoss = stats.totalHouseLoss;
    this.dailyProfit = stats.totalHouseProfit;
    console.log(`✅ Daily Stats Initialized: Loss: ${this.dailyLoss}, Profit: ${this.dailyProfit}`);
  }

  async checkDailyReset() {
    const today = new Date().toISOString().split('T')[0];
    if (this.currentDate !== today) {
      console.log(`🔄 Daily Reset Triggered: ${this.currentDate} -> ${today}`);
      this.currentDate = today;
      this.dailyLoss = 0;
      this.dailyProfit = 0;
      await DailyStat.create({ date: today }).catch(() => { });
    }
  }

  setIO(io) {
    this.io = io;
    this.startTimer();
  }

  setSocketMapping(firebaseUid, socketId) {
    this.userIdToSocket.set(firebaseUid, socketId);
  }

  removeSocketMapping(firebaseUid) {
    this.userIdToSocket.delete(firebaseUid);
  }

  updateUserCache(firebaseUid, bet) {
    let data = this.userLastBets.get(firebaseUid) || { bets: [], lastActive: Date.now() };
    data.bets.push(bet);
    if (data.bets.length > 5) data.bets.shift();
    data.lastActive = Date.now();
    this.userLastBets.set(firebaseUid, data);

    if (this.userLastBets.size > 10000) {
      this.userLastBets.clear();
    }
  }

  cleanupUserCache() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [uid, data] of this.userLastBets.entries()) {
      if (data.lastActive < oneHourAgo) {
        this.userLastBets.delete(uid);
      }
    }
  }

  isUserHighRisk(firebaseUid, curAmount) {
    const data = this.userLastBets.get(firebaseUid);
    const history = data ? data.bets : null;
    if (!history || history.length < 3) return false;

    let isDoubling = true;
    for (let i = 1; i < history.length; i++) {
      if (history[i].amount < history[i - 1].amount * 1.8) {
        isDoubling = false;
        break;
      }
    }

    if (isDoubling && curAmount >= history[history.length - 1].amount * 1.8) {
      return true;
    }
    return false;
  }

  generateResult() {
    const totals = this.currentRound.totals;
    const totalAmount = totals.Lion + totals.Tiger + totals.Draw;
    const exposures = {
      Lion: Math.floor(totals.Lion * 1.9),
      Tiger: Math.floor(totals.Tiger * 1.9),
      Draw: Math.floor(totals.Draw * 9)
    };

    // 🔴 Rule 1: Daily Limit Check (Hard Control)
    const isDailyLimitExceeded = this.dailyLoss - this.dailyProfit >= this.DAILY_MAX_LOSS_LIMIT;
    if (isDailyLimitExceeded) {
      return ["Lion", "Tiger", "Draw"].sort((a, b) => exposures[a] - exposures[b])[0];
    }

    // 🟢 Rule 2: Low Amount (Fair Game)
    if (totalAmount < this.HOUSE_EDGE_THRESHOLD) {
      const hash = crypto.randomBytes(16).toString('hex');
      const r = parseInt(hash.substring(0, 8), 16) / 0xFFFFFFFF;
      if (r < 0.4545) return "Lion";
      if (r < 0.9090) return "Tiger";
      return "Draw";
    }

    // 🟡 Rule 3: Dynamic House Edge (Making it look natural)
    const sortedSides = ["Lion", "Tiger", "Draw"].sort((a, b) => exposures[a] - exposures[b]);

    // Scale probability: Jiyada Amount = Jiyada House Bias (Max 82%)
    const minHouseBias = 0.65; // Base 65% house wins
    const maxHouseBias = 0.82; // Max 82% house wins
    const intensity = Math.min(1, totalAmount / this.EXPOSURE_LIMIT_PER_ROUND);
    const houseWinProb = minHouseBias + (intensity * (maxHouseBias - minHouseBias));

    const rand = Math.random();

    // Most of the time: House takes the least exposure side
    if (rand < houseWinProb) return sortedSides[0];

    // 10-15% chance: Second best side (Buffer)
    if (rand < 0.92) return sortedSides[1] || sortedSides[0];

    // 8% Luck Factor: User wins even on large bet (Trust builder)
    return sortedSides[2] || sortedSides[0];
  }

  async processRoundEnd() {
    await this.checkDailyReset();
    this.cleanupUserCache();

    this.currentRound.status = "result";
    const winner = this.generateResult();
    const message = winner === "Draw" ? "Tie! Draw Wins!" : `${winner} Wins!`;
    const roundBets = [...this.currentRound.bets];
    const rid = this.currentRound.roundId;

    await RoundResult.create({ roundId: rid, winner });

    if (this.io) {
      this.io.emit('result', { roundId: rid, result: winner, message });
    }

    const multiplier = winner === "Draw" ? 9 : 1.9;

    const roundHousePayout = roundBets.reduce((acc, bet) => {
      if (bet.side === winner) {
        return acc + Math.floor(bet.amount * multiplier);
      }
      return acc;
    }, 0);

    const roundHouseRevenue =
      this.currentRound.totals.Lion +
      this.currentRound.totals.Tiger +
      this.currentRound.totals.Draw;

    const payoutPromises = roundBets.map(async (bet) => {
      const isWinner = bet.side === winner;
      const payout = isWinner ? Math.floor(bet.amount * multiplier) : 0;

      // Bet settle karo
      // processRoundEnd mein — Bet.findOneAndUpdate query mein game filter
      const updateBet = Bet.findOneAndUpdate(
        { userId: bet.userId, roundId: bet.roundId, game: "lion_tiger" }, // ✅
        { won: isWinner, payout, status: "settled" }
      );

      // Winner ko coins credit karo — WePlayChat User collection mein
      let updateUser = null;
      if (isWinner && payout > 0) {
        updateUser = User.findOneAndUpdate(
          { firebaseUid: bet.userId },
          { $inc: { coin: payout } }   // ✅ coin field, WePlayChat wala
        );
      }

      await Promise.all([updateBet, updateUser].filter(p => p !== null));

      // Cache update
      this.updateUserCache(bet.userId, {
        amount: bet.amount,
        side: bet.side,
        won: isWinner,
        roundId: rid
      });

      // User ko result emit karo
      const socketId = this.userIdToSocket.get(bet.userId);
      if (socketId && this.io) {
        const user = await User.findOne({ firebaseUid: bet.userId }).select('coin');
        this.io.to(socketId).emit('betResult', {
          won: isWinner,
          payout,
          coin: user ? user.coin : 0   // ✅ coin field
        });
      }
    });

    await Promise.all(payoutPromises);

    this.dailyLoss += roundHousePayout;
    this.dailyProfit += roundHouseRevenue;

    await DailyStat.findOneAndUpdate(
      { date: this.currentDate },
      { $inc: { totalHouseLoss: roundHousePayout, totalHouseProfit: roundHouseRevenue } }
    );

    await new Promise(resolve => setTimeout(resolve, 4000));

    // Naya round start
    this.currentRound = {
      roundId: uuidv4(),
      time: 15,
      status: "betting",
      bets: [],
      totals: { Lion: 0, Tiger: 0, Draw: 0 }
    };
  }

  startTimer() {
    setInterval(async () => {
      if (this.currentRound.time > 0) {
        this.currentRound.time--;
        if (this.io) {
          this.io.emit('round', {
            roundId: this.currentRound.roundId,
            time: this.currentRound.time,
            status: this.currentRound.status,
            newRound: this.currentRound.time === 14,
            totals: this.currentRound.totals
          });
        }
      } else if (this.currentRound.status === "betting") {
        await this.processRoundEnd();
      }
    }, 1000);
  }

  getCurrentRound() {
    return this.currentRound;
  }

  addBetToCache(bet) {
    if (this.currentRound.status !== "betting") throw new Error("Betting is closed");
    if (this.currentRound.time <= 3) throw new Error("Too late to bet");

    const multiplier = bet.side === "Draw" ? 9 : 1.9;
    const exposure = Math.floor(
      (this.currentRound.totals[bet.side] + bet.amount) * multiplier
    );

    if (exposure > this.EXPOSURE_LIMIT_PER_ROUND) throw new Error("Pool limit reached");

    if (this.isUserHighRisk(bet.userId, bet.amount)) {
      throw new Error("Bet limit reduced due to high-risk pattern");
    }

    this.currentRound.bets.push(bet);
    this.currentRound.totals[bet.side] += bet.amount;
  }
}

export default new GameService();