/**
 * Vercel Serverless Function — catch-all API proxy
 * Wraps the Express app from server.js so all /api/* routes work on Vercel.
 */
const app = require('../server');

module.exports = app;
