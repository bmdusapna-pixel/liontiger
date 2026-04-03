import User from '../models/User.js';
import Bet from '../models/Bet.js';
import gameService from '../services/gameService.js';

const betTimeouts = new Map();

const socketHandler = (io) => {
  io.on('connection', (socket) => {
    console.log("✅ User connected:", socket.id);

    // ✅ Bet via socket
    socket.on('bet', async (data) => {
      const { userId, roundId, side, amount } = data;
      // userId = firebaseUid (Flutter se aayega)

      // Rate limiting
      const now = Date.now();
      const lastBet = betTimeouts.get(socket.id);
      if (lastBet && now - lastBet < 2000) {
        return socket.emit('error', { message: "Too many requests. Please wait." });
      }
      betTimeouts.set(socket.id, now);

      // Validation
      const parsedAmount = Math.floor(parseInt(amount));
      if (!parsedAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
        return socket.emit('error', { message: "Invalid amount" });
      }
      if (parsedAmount < 10) {
        return socket.emit('error', { message: "Minimum bet 10 coins" });
      }
      if (parsedAmount > 50000) {
        return socket.emit('error', { message: "Maximum bet 50,000 coins" });
      }

      const currentRound = gameService.getCurrentRound();

      // Socket ko firebaseUid se map karo
      gameService.setSocketMapping(userId, socket.id);
      socket.userId = userId; // disconnect pe remove karne ke liye

      if (!["Lion", "Tiger", "Draw"].includes(side)) {
        return socket.emit('error', { message: "Invalid side" });
      }
      if (currentRound.roundId !== roundId) {
        return socket.emit('error', { message: "Round expired" });
      }
      if (currentRound.status !== "betting" || currentRound.time <= 3) {
        return socket.emit('error', { message: "Betting is closed" });
      }

      const existingBet = currentRound.bets.find(b => b.userId === userId);
      if (existingBet) {
        return socket.emit('error', { message: "Already bet this round" });
      }

      try {
        // ✅ WePlayChat User collection se coin deduct
        const user = await User.findOneAndUpdate(
          {
            firebaseUid: userId,
            coin: { $gte: parsedAmount },
            isBlock: false
          },
          { $inc: { coin: -parsedAmount } },
          { new: true }
        );

        if (!user) {
          return socket.emit('error', { message: "Insufficient coins or user not found" });
        }

        const bet = { userId, roundId, side, amount: parsedAmount, timestamp: now };

        await Bet.create({ ...bet, won: false, payout: 0, status: "pending" });

        try {
          gameService.addBetToCache(bet);
        } catch (cacheErr) {
          // Rollback
          await User.findOneAndUpdate({ firebaseUid: userId }, { $inc: { coin: parsedAmount } });
          await Bet.deleteOne({ userId, roundId });
          return socket.emit('error', { message: cacheErr.message });
        }

        // ✅ Confirm emit with coin
        socket.emit('betConfirmed', {
          message: "Bet placed!",
          coin: user.coin,
          side,
          amount: parsedAmount
        });

      } catch (err) {
        console.error("Bet socket error:", err);
        socket.emit('error', { message: "Server error" });
      }
    });

    socket.on('disconnect', () => {
      if (socket.userId) {
        gameService.removeSocketMapping(socket.userId);
      }
      betTimeouts.delete(socket.id);
      console.log("⛵ User disconnected:", socket.id);
    });
  });
};

export default socketHandler;