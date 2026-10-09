/**
 * Borda Sweepstakes Savings — Backend API Server
 *
 * Proxies requests to Alpaca (paper trading) and Lightspark (Grid API)
 * so API keys never touch the client.
 *
 * Usage:
 *   npm install express cors node-fetch@2
 *   node server.js
 *
 * The server serves static files from this directory and exposes /api/* endpoints.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

// ── API Credentials (use env vars in production) ──────────────────────────
const ALPACA_KEY    = process.env.ALPACA_KEY    || 'PKNJQOSV6557ZBUXS4B7HW7HHG';
const ALPACA_SECRET = process.env.ALPACA_SECRET || 'AoBHdauh8cV59fYhTjvTS253bZu3hK3DFdyNsS5jyGwU';
const ALPACA_BASE   = process.env.ALPACA_BASE   || 'https://paper-api.alpaca.markets';
const ALPACA_DATA   = process.env.ALPACA_DATA   || 'https://data.alpaca.markets';

const LS_CLIENT_ID     = process.env.LIGHTSPARK_CLIENT_ID     || '01a0c1587cdf22ba0000ecacb2f5c832';
const LS_CLIENT_SECRET = process.env.LIGHTSPARK_CLIENT_SECRET || 'jTGc5ksqJ_IOl2ChwKEt5PVmGneGhskfoSjBvznsU0A';
const LS_BASE          = process.env.LIGHTSPARK_BASE          || 'https://api.lightspark.com/grid/2025-10-13';

const PORT = process.env.PORT || 3141;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Helpers ───────────────────────────────────────────────────────────────
async function alpacaFetch(urlPath, opts = {}) {
  // Dynamic import for node-fetch (CommonJS compat)
  const fetch = globalThis.fetch || (await import('node-fetch')).default;
  const url = `${ALPACA_BASE}${urlPath}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'APCA-API-KEY-ID': ALPACA_KEY,
      'APCA-API-SECRET-KEY': ALPACA_SECRET,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function lightsparkFetch(urlPath, opts = {}) {
  const fetch = globalThis.fetch || (await import('node-fetch')).default;
  const url = `${LS_BASE}${urlPath}`;
  const auth = Buffer.from(`${LS_CLIENT_ID}:${LS_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Alpaca Market Data API helper (data.alpaca.markets — separate from trading)
async function alpacaDataFetch(urlPath, opts = {}) {
  const fetch = globalThis.fetch || (await import('node-fetch')).default;
  const url = `${ALPACA_DATA}${urlPath}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'APCA-API-KEY-ID': ALPACA_KEY,
      'APCA-API-SECRET-KEY': ALPACA_SECRET,
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ── Alpaca Market Data Endpoints ─────────────────────────────────────────

// GET /api/alpaca/quotes?symbols=AAPL,TSLA,GOOGL — latest quotes for multiple symbols
app.get('/api/alpaca/quotes', async (req, res) => {
  try {
    const symbols = req.query.symbols || '';
    const { status, data } = await alpacaDataFetch(`/v2/stocks/quotes/latest?symbols=${encodeURIComponent(symbols)}`);
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/alpaca/snapshots?symbols=AAPL,TSLA — multi-symbol snapshots (price, volume, prev close)
app.get('/api/alpaca/snapshots', async (req, res) => {
  try {
    const symbols = req.query.symbols || '';
    const { status, data } = await alpacaDataFetch(`/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols)}`);
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/alpaca/snapshot/:symbol — single symbol snapshot
app.get('/api/alpaca/snapshot/:symbol', async (req, res) => {
  try {
    const { status, data } = await alpacaDataFetch(`/v2/stocks/${req.params.symbol}/snapshot`);
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/alpaca/bars/:symbol — historical bars for charting
app.get('/api/alpaca/bars/:symbol', async (req, res) => {
  try {
    const { timeframe = '1Day', start, end, limit = '30' } = req.query;
    let qs = `timeframe=${timeframe}&limit=${limit}`;
    if (start) qs += `&start=${start}`;
    if (end) qs += `&end=${end}`;
    const { status, data } = await alpacaDataFetch(`/v2/stocks/${req.params.symbol}/bars?${qs}`);
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/alpaca/logo/:symbol — Alpaca stock logo URL
app.get('/api/alpaca/logo/:symbol', async (req, res) => {
  try {
    // Alpaca provides logos through their assets endpoint; we proxy the logo URL
    const { status, data } = await alpacaFetch(`/v2/assets/${req.params.symbol}`);
    if (data && data.name) {
      // Construct Alpaca media logo URL
      res.json({
        symbol: req.params.symbol,
        name: data.name,
        logoUrl: `https://storage.googleapis.com/iexcloud-hl37opg/api/logos/${req.params.symbol}.png`,
        exchange: data.exchange,
        class: data.class,
        tradable: data.tradable,
        fractionable: data.fractionable,
      });
    } else {
      res.status(status).json(data);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Alpaca Trading Endpoints ─────────────────────────────────────────────

// GET /api/alpaca/account
app.get('/api/alpaca/account', async (req, res) => {
  try {
    const { status, data } = await alpacaFetch('/v2/account');
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/alpaca/positions
app.get('/api/alpaca/positions', async (req, res) => {
  try {
    const { status, data } = await alpacaFetch('/v2/positions');
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/alpaca/positions/:symbol
app.get('/api/alpaca/positions/:symbol', async (req, res) => {
  try {
    const { status, data } = await alpacaFetch(`/v2/positions/${req.params.symbol}`);
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/alpaca/orders — place an order
app.post('/api/alpaca/orders', async (req, res) => {
  try {
    const { status, data } = await alpacaFetch('/v2/orders', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/alpaca/orders
app.get('/api/alpaca/orders', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const { status, data } = await alpacaFetch(`/v2/orders${qs ? '?' + qs : ''}`);
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/alpaca/orders/:id — cancel an order
app.delete('/api/alpaca/orders/:id', async (req, res) => {
  try {
    const { status, data } = await alpacaFetch(`/v2/orders/${req.params.id}`, { method: 'DELETE' });
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/alpaca/positions/:symbol — close a position
app.delete('/api/alpaca/positions/:symbol', async (req, res) => {
  try {
    const { status, data } = await alpacaFetch(`/v2/positions/${req.params.symbol}`, { method: 'DELETE' });
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/alpaca/assets/:symbol — get asset info
app.get('/api/alpaca/assets/:symbol', async (req, res) => {
  try {
    const { status, data } = await alpacaFetch(`/v2/assets/${req.params.symbol}`);
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Lightspark Grid Endpoints ─────────────────────────────────────────────

// POST /api/lightspark/customers — Create a customer (KYC onboarding)
app.post('/api/lightspark/customers', async (req, res) => {
  try {
    const { status, data } = await lightsparkFetch('/customers', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/lightspark/customers/:id
app.get('/api/lightspark/customers/:id', async (req, res) => {
  try {
    const { status, data } = await lightsparkFetch(`/customers/${req.params.id}`);
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/lightspark/customers/:id/kyc-link — Generate hosted KYC link
app.post('/api/lightspark/customers/:id/kyc-link', async (req, res) => {
  try {
    const { status, data } = await lightsparkFetch(`/customers/${req.params.id}/kyc-link`, {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/lightspark/quotes — Create a quote (deposit/withdrawal)
app.post('/api/lightspark/quotes', async (req, res) => {
  try {
    const { status, data } = await lightsparkFetch('/quotes', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/lightspark/sandbox/send — Simulate funding (sandbox only)
app.post('/api/lightspark/sandbox/send', async (req, res) => {
  try {
    const { status, data } = await lightsparkFetch('/sandbox/send', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/lightspark/sandbox/fund — Fund internal account (sandbox only)
app.post('/api/lightspark/sandbox/fund/:accountId', async (req, res) => {
  try {
    const { status, data } = await lightsparkFetch(`/sandbox/internal-accounts/${req.params.accountId}/fund`, {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Lightspark Bitcoin Endpoints ─────────────────────────────────────────

// GET /api/bitcoin/price — Get current BTC price (uses public CoinGecko API)
app.get('/api/bitcoin/price', async (req, res) => {
  try {
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true');
    const data = await r.json();
    res.json({
      price: data.bitcoin.usd,
      change24h: data.bitcoin.usd_24h_change,
      volume24h: data.bitcoin.usd_24h_vol,
      marketCap: data.bitcoin.usd_market_cap,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/bitcoin/history — BTC price history for charting
app.get('/api/bitcoin/history', async (req, res) => {
  try {
    const days = req.query.days || '7';
    const fetch = globalThis.fetch || (await import('node-fetch')).default;
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`);
    const data = await r.json();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/bitcoin/buy — Buy BTC via Lightspark (creates quote + executes)
app.post('/api/bitcoin/buy', async (req, res) => {
  try {
    const { customerId, amountUsd } = req.body;
    // Create a deposit quote for the customer
    const { status, data } = await lightsparkFetch('/quotes', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: customerId,
        estimated_amount: {
          currency_amount_value: Math.round(amountUsd * 100),
          currency_amount_unit: 'USD',
        },
        payment_direction: 'RECEIVED',
        payment_type: 'ON_CHAIN',
      }),
    });
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/bitcoin/sell — Sell BTC via Lightspark (creates withdrawal quote)
app.post('/api/bitcoin/sell', async (req, res) => {
  try {
    const { customerId, amountUsd } = req.body;
    const { status, data } = await lightsparkFetch('/quotes', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: customerId,
        estimated_amount: {
          currency_amount_value: Math.round(amountUsd * 100),
          currency_amount_unit: 'USD',
        },
        payment_direction: 'SENT',
        payment_type: 'ON_CHAIN',
      }),
    });
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/bitcoin/send — Send BTC to an address via Lightspark
app.post('/api/bitcoin/send', async (req, res) => {
  try {
    const { customerId, address, amountSats } = req.body;
    const { status, data } = await lightsparkFetch('/payments', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: customerId,
        destination: address,
        amount: {
          currency_amount_value: amountSats,
          currency_amount_unit: 'SATOSHI',
        },
        payment_type: 'ON_CHAIN',
      }),
    });
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/bitcoin/balance/:customerId — Get customer BTC balance
app.get('/api/bitcoin/balance/:customerId', async (req, res) => {
  try {
    const { status, data } = await lightsparkFetch(`/customers/${req.params.customerId}`);
    res.status(status).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Borda-specific Endpoints ──────────────────────────────────────────────

// POST /api/spins/calculate — Calculate spins earned from balance
// $1,000 average daily balance = 1 spin
app.post('/api/spins/calculate', (req, res) => {
  const { averageDailyBalance = 0, cardSpend = 0 } = req.body;
  const spinsFromBalance = averageDailyBalance / 1000;
  const spinsFromSpend = cardSpend / 1000;
  const totalSpins = spinsFromBalance + spinsFromSpend;
  res.json({
    spinsFromBalance: Math.round(spinsFromBalance * 10000) / 10000,
    spinsFromSpend: Math.round(spinsFromSpend * 10000) / 10000,
    totalSpinsEarned: Math.round(totalSpins * 10000) / 10000,
  });
});

// ── ACAT Transfers (Alpaca Account Transfers) ──────────────────────────
// Initiate an ACAT transfer-in from another brokerage
app.post('/api/alpaca/transfers/acat', async (req, res) => {
  const { status, data } = await alpacaFetch('/v1/accounts/{account_id}/transfers', {
    method: 'POST',
    body: JSON.stringify({
      transfer_type: 'ACAT',
      direction: 'INCOMING',
      ...req.body,
    }),
  });
  res.status(status).json(data);
});

// List all ACAT transfers
app.get('/api/alpaca/transfers', async (req, res) => {
  const { status, data } = await alpacaFetch('/v1/accounts/{account_id}/transfers');
  res.status(status).json(data);
});

// Get a specific transfer by ID
app.get('/api/alpaca/transfers/:id', async (req, res) => {
  const { status, data } = await alpacaFetch(`/v1/accounts/{account_id}/transfers/${req.params.id}`);
  res.status(status).json(data);
});

// Cancel a pending transfer
app.delete('/api/alpaca/transfers/:id', async (req, res) => {
  const { status, data } = await alpacaFetch(`/v1/accounts/{account_id}/transfers/${req.params.id}`, { method: 'DELETE' });
  res.status(status).json(data);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Route: /chances serves the odds disclosure page ─────────────────────
app.get('/chances', (req, res) => {
  res.sendFile(path.join(__dirname, 'chances.html'));
});

// ── Route: /demo-user serves the full app ────────────────────────────────
app.get('/demo-user', (req, res) => {
  res.sendFile(path.join(__dirname, 'demo-user', 'index.html'));
});
app.get('/demo-user/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'demo-user', 'index.html'));
});

// ── Fallback: serve waitlist landing at root ─────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Export for Vercel serverless; start listening only when run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  🎰 Borda Sweepstakes Savings API`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  Alpaca:  Paper Trading (sandbox)`);
    console.log(`  Grid:    Lightspark Grid API\n`);
  });
}

module.exports = app;
