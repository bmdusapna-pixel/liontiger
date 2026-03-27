const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" }
});

let currentRound = {
  id: Date.now(),
  time: 15,
  bets: []
};

function generateResult() {
  const hash = crypto.randomBytes(16).toString('hex');
  const num = parseInt(hash.substring(0, 8), 16);
  return num % 2 === 0 ? "Lion" : "Tiger";
}

// Timer loop
setInterval(() => {
  if (currentRound.time > 0) {
    currentRound.time--;

    io.emit('round', {
      roundId: currentRound.id,
      time: currentRound.time
    });

  } else {
    const result = generateResult();

    io.emit('result', {
      result: result,
      roundId: currentRound.id
    });

    // New round
    currentRound = {
      id: Date.now(),
      time: 15,
      bets: []
    };
  }
}, 1000);

// Socket connection
io.on('connection', (socket) => {
  console.log("User connected");

  socket.on('bet', (data) => {
    currentRound.bets.push(data);
  });

  socket.on('disconnect', () => {
    console.log("User disconnected");
  });
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});