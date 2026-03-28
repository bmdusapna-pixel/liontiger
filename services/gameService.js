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
    this.userIdToSocket = new Map();
    this.userLastBets = new Map();

    this.EXPOSURE_LIMIT_PER_ROUND = 500000;
    this.DAILY_MAX_LOSS_LIMIT = 500000;
    this.HOUSE_EDGE_THRESHOLD = 3000;

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
    console.log(` Daily Stats Initialized: Loss: ${this.dailyLoss}, Profit: ${this.dailyProfit}`);
  }

  async checkDailyReset() {
    const today = new Date().toISOString().split('T')[0];
    if (this.currentDate !== today) {
      console.log(` Daily Reset Triggered: ${this.currentDate} -> ${today}`);
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

  setSocketMapping(userId, socketId) {
    this.userIdToSocket.set(userId, socketId);
  }

  removeSocketMapping(userId) {
    this.userIdToSocket.delete(userId);
  }

  updateUserCache(userId, bet) {
    let data = this.userLastBets.get(userId) || { bets: [], lastActive: Date.now() };

    data.bets.push(bet);
    if (data.bets.length > 5) data.bets.shift();
    data.lastActive = Date.now();

    this.userLastBets.set(userId, data);

    if (this.userLastBets.size > 10000) {
      this.userLastBets.clear();
    }
  }

  cleanupUserCache() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [userId, data] of this.userLastBets.entries()) {
      if (data.lastActive < oneHourAgo) {
        this.userLastBets.delete(userId);
      }
    }
  }

  isUserHighRisk(userId, curAmount) {
    const data = this.userLastBets.get(userId);
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
    const exposures = {
      Lion: Math.floor(totals.Lion * 1.9),
      Tiger: Math.floor(totals.Tiger * 1.9),
      Draw: Math.floor(totals.Draw * 9)
    };

    const isDailyLimitExceeded = this.dailyLoss - this.dailyProfit >= this.DAILY_MAX_LOSS_LIMIT;
    if (isDailyLimitExceeded) {
      return ["Lion", "Tiger", "Draw"].sort((a, b) => exposures[a] - exposures[b])[0];
    }

    const totalAmount = totals.Lion + totals.Tiger + totals.Draw;
    if (totalAmount < this.HOUSE_EDGE_THRESHOLD) {
      const hash = crypto.randomBytes(16).toString('hex');
      const r = parseInt(hash.substring(0, 8), 16) / 0xFFFFFFFF;
      if (r < 0.4545) return "Lion";
      if (r < 0.9090) return "Tiger";
      return "Draw";
    }

    const sortedSides = ["Lion", "Tiger", "Draw"].sort((a, b) => exposures[a] - exposures[b]);
    const rand = Math.random();
    if (rand < 0.70) return sortedSides[0];
    if (rand < 0.90) return sortedSides[1] || sortedSides[0];
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
    const roundHouseRevenue = this.currentRound.totals.Lion + this.currentRound.totals.Tiger + this.currentRound.totals.Draw;

    const payoutPromises = roundBets.map(async (bet) => {
      const isWinner = bet.side === winner;
      const payout = isWinner ? Math.floor(bet.amount * multiplier) : 0;

      const updateBet = Bet.findOneAndUpdate(
        { userId: bet.userId, roundId: bet.roundId },
        { won: isWinner, payout, status: "settled" }
      );

      let updateUser = null;
      if (isWinner && payout > 0) {
        updateUser = User.findOneAndUpdate(
          { userId: bet.userId },
          { $inc: { balance: payout } }
        );
      }

      await Promise.all([updateBet, updateUser].filter(p => p !== null));

      this.updateUserCache(bet.userId, {
        amount: bet.amount,
        side: bet.side,
        won: isWinner,
        roundId: rid
      });

      const socketId = this.userIdToSocket.get(bet.userId);
      if (socketId && this.io) {
        const user = await User.findOne({ userId: bet.userId }).select('balance');
        this.io.to(socketId).emit('betResult', {
          won: isWinner,
          payout,
          balance: user ? user.balance : 0
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

  getCurrentRound() { return this.currentRound; }

  addBetToCache(bet) {
    if (this.currentRound.status !== "betting") throw new Error("Betting is closed");
    if (this.currentRound.time <= 3) throw new Error("Too late to bet");

    const multiplier = bet.side === "Draw" ? 9 : 1.9;
    const exposure = Math.floor((this.currentRound.totals[bet.side] + bet.amount) * multiplier);

    if (exposure > this.EXPOSURE_LIMIT_PER_ROUND) throw new Error("Pool limit reached");

    if (this.isUserHighRisk(bet.userId, bet.amount)) {
      throw new Error("Bet limit reduced due to high-risk pattern");
    }

    this.currentRound.bets.push(bet);
    this.currentRound.totals[bet.side] += bet.amount;
  }
}

export default new GameService();