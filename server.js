const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(cors()); // ✅ FIX CORS

const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" }
});

// ---------------- DATA ----------------
let users = [];
let currentRound = {
  roundId: uuidv4(),
  time: 15,
  status: "betting",
  bets: []
};
let betHistory = []; // Store all bets for history
let roundResults = {}; // Store results for each round

// ---------------- API ----------------

// 1. GET /wallet/:userId - Returns user balance
app.get('/wallet/:userId', (req, res) => {
  const { userId } = req.params;
  const user = users.find(u => u.userId === userId);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json({ balance: user.balance });
});

// 2. GET /round/current - Returns current active round
app.get('/round/current', (req, res) => {
  res.json({
    roundId: currentRound.roundId,
    time: currentRound.time,
    status: currentRound.status
  });
});

// 3. POST /bet - Place a bet for a user
app.post('/bet', (req, res) => {
  const { userId, roundId, side, amount } = req.body;

  // Validate side
  if (side !== "Lion" && side !== "Tiger") {
    return res.status(400).json({
      success: false,
      message: "Invalid side. Must be 'Lion' or 'Tiger'"
    });
  }

  // Validate round
  if (roundId !== currentRound.roundId) {
    return res.status(400).json({
      success: false,
      message: "Round expired"
    });
  }

  // Check betting time
  if (currentRound.time <= 3) {
    return res.status(400).json({
      success: false,
      message: "Betting is closed"
    });
  }

  // Find user
  const user = users.find(u => u.userId === userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found"
    });
  }

  // Check balance
  if (user.balance < amount) {
    return res.status(400).json({
      success: false,
      message: "Insufficient balance"
    });
  }

  // Check if user already bet this round
  const existingBet = currentRound.bets.find(b => b.userId === userId);
  if (existingBet) {
    return res.status(400).json({
      success: false,
      message: "Already bet this round"
    });
  }

  // Deduct balance
  user.balance -= amount;

  // Place bet
  const bet = {
    userId,
    roundId,
    side,
    amount,
    timestamp: Date.now()
  };
  currentRound.bets.push(bet);
  betHistory.push(bet);

  res.json({
    success: true,
    message: "Bet placed!",
    balance: user.balance
  });
});

// 4. GET /history/:userId - Returns last 50 bets for a user
app.get('/history/:userId', (req, res) => {
  const { userId } = req.params;
  const userBets = betHistory
    .filter(bet => bet.userId === userId)
    .slice(-50) // Last 50 bets
    .map(bet => {
      const result = roundResults[bet.roundId];
      const won = result && result.winner === bet.side;
      return {
        roundId: bet.roundId,
        side: bet.side,
        amount: bet.amount,
        won: won,
        payout: won ? bet.amount * 2 : 0
      };
    });

  res.json(userBets);
});

// register (updated to use userId)
app.post('/register', (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: "userId required" });
  }
  const existingUser = users.find(u => u.userId === userId);
  if (existingUser) {
    return res.status(400).json({ error: "User already exists" });
  }
  users.push({ userId, balance: 1000 });
  res.json({ status: "ok" });
});

// ---------------- GAME LOGIC ----------------

function generateResult() {
  const hash = crypto.randomBytes(16).toString('hex');
  const num = parseInt(hash.substring(0, 8), 16);
  return num % 2 === 0 ? "Lion" : "Tiger";
}

// timer
setInterval(() => {
  if (currentRound.time > 0) {
    currentRound.time--;

    io.emit('round', {
      roundId: currentRound.roundId,
      time: currentRound.time,
      status: "betting",
      newRound: currentRound.time === 14 // true only on first emit of new round
    });

  } else {
    // Generate result
    const winner = generateResult();
    const message = `${winner} Wins!`;

    // Store result for history
    roundResults[currentRound.roundId] = {
      winner,
      message,
      timestamp: Date.now()
    };

    // Emit result to ALL clients
    io.emit('result', {
      roundId: currentRound.roundId,
      result: winner,
      message: message
    });

    // Process payouts
    currentRound.bets.forEach(bet => {
      const user = users.find(u => u.userId === bet.userId);
      if (user && bet.side === winner) {
        user.balance += bet.amount * 2; // Win: balance += amount * 2
      }
      // Lose: no change (amount already deducted on bet)
    });

    // Wait 4 seconds then start new round
    setTimeout(() => {
      currentRound = {
        roundId: uuidv4(),
        time: 15,
        status: "betting",
        bets: []
      };
    }, 4000);
  }
}, 1000);

// socket
io.on('connection', (socket) => {
  console.log("User connected");

  socket.on('bet', (data) => {
    const { userId, roundId, side, amount } = data;

    // Validate side
    if (side !== "Lion" && side !== "Tiger") {
      socket.emit('error', { message: "Invalid side. Must be 'Lion' or 'Tiger'" });
      return;
    }

    // Validate round
    if (roundId !== currentRound.roundId) {
      socket.emit('error', { message: "Round expired" });
      return;
    }

    // Check betting time
    if (currentRound.time <= 3) {
      socket.emit('error', { message: "Betting is closed" });
      return;
    }

    // Find user
    const user = users.find(u => u.userId === userId);
    if (!user) {
      socket.emit('error', { message: "User not found" });
      return;
    }

    // Check balance
    if (user.balance < amount) {
      socket.emit('error', { message: "Insufficient balance" });
      return;
    }

    // Check if user already bet this round
    const existingBet = currentRound.bets.find(b => b.userId === userId);
    if (existingBet) {
      socket.emit('error', { message: "Already bet this round" });
      return;
    }

    // Deduct balance
    user.balance -= amount;

    // Place bet
    const bet = {
      userId,
      roundId,
      side,
      amount,
      timestamp: Date.now()
    };
    currentRound.bets.push(bet);
    betHistory.push(bet);

    // Emit betConfirmed to this socket
    socket.emit('betConfirmed', {
      message: "Bet placed!",
      balance: user.balance,
      side: side,
      amount: amount
    });
  });

  socket.on('disconnect', () => {
    console.log("User disconnected");
  });
});

// ---------------- START ----------------
server.listen(3000, () => {
  console.log("Server running on port 3000");
});