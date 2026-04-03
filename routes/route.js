import express from 'express';
import {
    getWallet,
    getHistory,
    getCurrentRound,
    placeBet,
    getRecentResults,
    getRoundStats
} from '../controllers/gameController.js';
import { apiLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// ❌ /register REMOVED — WePlayChat handle karta hai
router.get('/wallet/:userId', getWallet);        // userId = firebaseUid
router.get('/round/current', getCurrentRound);
router.post('/bet', apiLimiter, placeBet);
router.get('/history/:userId', getHistory);      // userId = firebaseUid
router.get('/results/history', getRecentResults);
router.get('/round/stats', getRoundStats);

export default router;