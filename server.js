import http from 'http';
import { Server } from 'socket.io';
import app from './app.js';
import connectDB from './config/database.js';
import socketHandler from './socket/socketHandler.js';
import gameService from './services/gameService.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;

await connectDB();

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

gameService.setIO(io);
socketHandler(io);

server.listen(PORT, () => {
  console.log(`🚀 Server running in production mode on port ${PORT}`);
});