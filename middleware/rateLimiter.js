import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: "Too many requests, please try again later." }
});

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: { error: "Action blocked due to high activity." }
});
