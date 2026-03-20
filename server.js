const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');
const cors = require('cors');

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
  id: Date.now(),
  time: 15,
  bets: []
};
let currentResult = "Lion";

// ---------------- API ----------------

// register
app.post('/register', (req, res) => {
  const { username } = req.body;
  users.push({ username, balance: 1000 });
  res.json({ status: "ok" });
});

// place bet
app.post('/bet', (req, res) => {
  const { username, side, amount } = req.body;
  currentRound.bets.push({ username, side, amount });
  res.json({ status: "bet placed" });
});

// get result
app.get('/result', (req, res) => {
  res.json({ result: currentResult });
});

// ✅ ADMIN CONTROL (your missing API)
app.post('/set-result', (req, res) => {
  const { result } = req.body;
  currentResult = result;
  res.json({ status: "result set by admin" });
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
      roundId: currentRound.id,
      time: currentRound.time
    });

  } else {
    // use admin result if set, else random
    const result = currentResult || generateResult();

    io.emit('result', {
      result: result,
      roundId: currentRound.id
    });

    // reset round
    currentRound = {
      id: Date.now(),
      time: 15,
      bets: []
    };
  }
}, 1000);

// socket
io.on('connection', (socket) => {
  console.log("User connected");

  socket.on('bet', (data) => {
    currentRound.bets.push(data);
  });

  socket.on('disconnect', () => {
    console.log("User disconnected");
  });
});

// ---------------- START ----------------
server.listen(3000, () => {
  console.log("Server running on port 3000");
});