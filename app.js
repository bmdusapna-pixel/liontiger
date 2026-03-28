import express from 'express';
import cors from 'cors';
import { globalLimiter } from './middleware/rateLimiter.js';
import apiRoutes from './routes/route.js';

const app = express();

app.use(express.json());
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: "Invalid JSON format" });
  }
  next();
});

app.use(cors());

app.use(globalLimiter);

app.use('/', apiRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'up' });
});

export default app;
