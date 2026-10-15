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

// ── Supabase (waitlist database) ─────────────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL  || '';
const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY || '';

// ── Resend (transactional email) ─────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

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

// ── Supabase Helper ──────────────────────────────────────────────────────
async function supabaseFetch(table, opts = {}) {
  const fetch = globalThis.fetch || (await import('node-fetch')).default;
  const { method = 'GET', query = '', body, headers: extra = {}, single = false } = opts;
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(single ? { Accept: 'application/vnd.pqrs.object+json' } : {}),
    ...extra,
  };
  if (method === 'POST' || method === 'PATCH') {
    headers['Prefer'] = 'return=representation';
  }
  const res = await fetch(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// ── Resend Email Helper ──────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) return { success: false, error: 'No Resend API key configured' };
  const fetch = globalThis.fetch || (await import('node-fetch')).default;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Borda <hello@borda.ai>', to: [to], subject, html }),
    });
    const data = await res.json();
    return { success: res.ok, data };
  } catch (e) { return { success: false, error: e.message }; }
}

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'BORDA-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function welcomeEmailHtml(position, referralCode, referralLink) {
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0B0E11;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:40px 20px;">
  <div style="text-align:center;margin-bottom:32px;">
    <span style="font-size:28px;font-weight:800;color:#00DC82;">Borda</span>
  </div>
  <div style="background:#141821;border-radius:16px;padding:32px 24px;border:1px solid rgba(255,255,255,0.06);">
    <h1 style="color:#EAECEF;font-size:24px;margin:0 0 8px;text-align:center;">You're on the list! 🎉</h1>
    <p style="color:#848E9C;font-size:15px;line-height:1.6;text-align:center;margin:0 0 24px;">
      Welcome to the Borda waitlist. Your savings will soon win you real stocks.
    </p>
    <div style="background:#0B0E11;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
      <div style="font-size:11px;color:#5E6673;letter-spacing:1px;font-weight:600;">YOUR POSITION</div>
      <div style="font-size:48px;font-weight:800;color:#00DC82;line-height:1.2;">#${position.toLocaleString()}</div>
    </div>
    <p style="color:#848E9C;font-size:14px;line-height:1.6;margin:0 0 16px;">
      <strong style="color:#EAECEF;">Move up faster!</strong> Share your referral link to skip the line and earn bonus spins.
    </p>
    <div style="background:#1C2230;border-radius:10px;padding:14px 16px;margin-bottom:24px;">
      <div style="font-size:11px;color:#5E6673;letter-spacing:0.5px;font-weight:600;margin-bottom:6px;">YOUR REFERRAL LINK</div>
      <a href="${referralLink}" style="color:#00DC82;font-size:14px;font-weight:600;text-decoration:none;word-break:break-all;">${referralLink}</a>
    </div>
    <div style="background:#1C2230;border-radius:10px;padding:14px 16px;margin-bottom:24px;">
      <div style="font-size:11px;color:#5E6673;letter-spacing:0.5px;font-weight:600;margin-bottom:6px;">YOUR REFERRAL CODE</div>
      <div style="color:#EAECEF;font-size:18px;font-weight:700;letter-spacing:2px;">${referralCode}</div>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr>
        <td style="background:rgba(0,220,130,0.08);border-radius:8px;padding:12px;text-align:center;border:1px solid rgba(0,220,130,0.15);">
          <div style="font-size:11px;color:#5E6673;">3 referrals</div>
          <div style="font-size:13px;color:#00DC82;font-weight:600;">+5 spins</div>
        </td>
        <td width="8"></td>
        <td style="background:rgba(0,220,130,0.08);border-radius:8px;padding:12px;text-align:center;border:1px solid rgba(0,220,130,0.15);">
          <div style="font-size:11px;color:#5E6673;">5 referrals</div>
          <div style="font-size:13px;color:#00DC82;font-weight:600;">Skip 500</div>
        </td>
        <td width="8"></td>
        <td style="background:rgba(0,220,130,0.08);border-radius:8px;padding:12px;text-align:center;border:1px solid rgba(0,220,130,0.15);">
          <div style="font-size:11px;color:#5E6673;">10 referrals</div>
          <div style="font-size:13px;color:#00DC82;font-weight:600;">+15 spins</div>
        </td>
        <td width="8"></td>
        <td style="background:rgba(255,184,0,0.1);border-radius:8px;padding:12px;text-align:center;border:1px solid rgba(255,184,0,0.2);">
          <div style="font-size:11px;color:#5E6673;">25 referrals</div>
          <div style="font-size:13px;color:#FFB800;font-weight:600;">Priority 👑</div>
        </td>
      </tr>
    </table>
  </div>
  <p style="color:#5E6673;font-size:11px;text-align:center;margin-top:24px;line-height:1.6;">
    Borda, Inc. · No purchase necessary · Void where prohibited<br>
    <a href="https://borda-ai-sigma.vercel.app/terms" style="color:#848E9C;">Terms</a> ·
    <a href="https://borda-ai-sigma.vercel.app/privacy" style="color:#848E9C;">Privacy</a> ·
    <a href="https://borda-ai-sigma.vercel.app/rules" style="color:#848E9C;">Official Rules</a>
  </p>
</div>
</body></html>`;
}

function referralNotificationHtml(referrerCode, newCount, position) {
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0B0E11;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:40px 20px;">
  <div style="text-align:center;margin-bottom:32px;">
    <span style="font-size:28px;font-weight:800;color:#00DC82;">Borda</span>
  </div>
  <div style="background:#141821;border-radius:16px;padding:32px 24px;border:1px solid rgba(255,255,255,0.06);">
    <h1 style="color:#EAECEF;font-size:22px;margin:0 0 8px;text-align:center;">A friend just joined! 🎉</h1>
    <p style="color:#848E9C;font-size:15px;line-height:1.6;text-align:center;margin:0 0 24px;">
      Someone used your referral link to join the Borda waitlist. You've moved up!
    </p>
    <div style="display:flex;gap:12px;margin-bottom:16px;">
      <div style="flex:1;background:#0B0E11;border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:11px;color:#5E6673;letter-spacing:0.5px;font-weight:600;">REFERRALS</div>
        <div style="font-size:28px;font-weight:800;color:#FFB800;">${newCount}</div>
      </div>
      <div style="flex:1;background:#0B0E11;border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:11px;color:#5E6673;letter-spacing:0.5px;font-weight:600;">POSITION</div>
        <div style="font-size:28px;font-weight:800;color:#00DC82;">#${position.toLocaleString()}</div>
      </div>
    </div>
    <p style="color:#848E9C;font-size:14px;text-align:center;margin:0;">
      Keep sharing to unlock more rewards!
    </p>
  </div>
  <p style="color:#5E6673;font-size:11px;text-align:center;margin-top:24px;">
    Borda, Inc. · <a href="https://borda-ai-sigma.vercel.app/terms" style="color:#848E9C;">Terms</a> ·
    <a href="https://borda-ai-sigma.vercel.app/privacy" style="color:#848E9C;">Privacy</a>
  </p>
</div>
</body></html>`;
}

// ── Waitlist API Endpoints ──────────────────────────────────────────────

// POST /api/waitlist/signup — Register a new waitlist signup
app.post('/api/waitlist/signup', async (req, res) => {
  try {
    const { email, referredBy } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    // Check if Supabase is configured
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(503).json({ error: 'Waitlist database not configured' });
    }

    // Check for existing signup
    const existing = await supabaseFetch('waitlist_signups', {
      query: `email=eq.${encodeURIComponent(email.toLowerCase())}&select=*`,
      single: true,
    });
    if (existing.status === 200 && existing.data && existing.data.email) {
      return res.json({
        alreadyExists: true,
        position: existing.data.position,
        referralCode: existing.data.referral_code,
        bonusSpins: existing.data.bonus_spins,
        referralCount: existing.data.referral_count,
      });
    }

    // Get current count for position
    const countRes = await supabaseFetch('waitlist_signups', {
      query: 'select=id',
      headers: { Prefer: 'count=exact', Range: '0-0' },
    });
    const totalSignups = parseInt(countRes.data?.length || '0') + 52847; // base + real signups
    const position = Math.floor(Math.random() * 200) + totalSignups - 200;
    const referralCode = generateReferralCode();

    // Insert signup
    const { status, data } = await supabaseFetch('waitlist_signups', {
      method: 'POST',
      body: {
        email: email.toLowerCase(),
        position,
        referral_code: referralCode,
        referred_by: referredBy || null,
        bonus_spins: 3,
        referral_count: 0,
      },
    });

    if (status >= 400) {
      return res.status(status).json({ error: 'Signup failed', details: data });
    }

    const signup = Array.isArray(data) ? data[0] : data;
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://borda-ai-sigma.vercel.app';
    const referralLink = `${baseUrl}?ref=${referralCode}`;

    // Send welcome email (async, don't block response)
    sendEmail({
      to: email,
      subject: `You're #${position.toLocaleString()} on the Borda waitlist! 🎰`,
      html: welcomeEmailHtml(position, referralCode, referralLink),
    }).then(result => {
      // Log email
      if (SUPABASE_URL) {
        supabaseFetch('email_log', {
          method: 'POST',
          body: { recipient_email: email, email_type: 'welcome', status: result.success ? 'sent' : 'failed' },
        }).catch(() => {});
      }
    }).catch(() => {});

    // If referred, update the referrer
    if (referredBy) {
      processReferral(referredBy, email).catch(() => {});
    }

    res.json({
      success: true,
      position: signup.position,
      referralCode: signup.referral_code,
      bonusSpins: signup.bonus_spins,
      referralCount: 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Process a referral (update referrer's stats, send notification)
async function processReferral(referrerCode, refereeEmail) {
  // Get referrer
  const referrer = await supabaseFetch('waitlist_signups', {
    query: `referral_code=eq.${encodeURIComponent(referrerCode)}&select=*`,
    single: true,
  });
  if (referrer.status !== 200 || !referrer.data?.email) return;

  const newCount = (referrer.data.referral_count || 0) + 1;

  // Calculate rewards
  const REWARDS = [
    { count: 3, spins: 5, skip: 0 },
    { count: 5, spins: 0, skip: 500 },
    { count: 10, spins: 15, skip: 0 },
    { count: 25, spins: 0, skip: 0 }, // priority access
  ];
  let bonusSpinsToAdd = 0;
  let positionSkip = 0;
  const milestone = REWARDS.find(r => r.count === newCount);
  if (milestone) {
    bonusSpinsToAdd = milestone.spins;
    positionSkip = milestone.skip;
  }

  // Each referral moves ~100 spots up
  const moveUp = Math.floor(Math.random() * 80 + 60) + positionSkip;
  const newPosition = Math.max(1, referrer.data.position - moveUp);
  const newSpins = referrer.data.bonus_spins + bonusSpinsToAdd;

  // Update referrer
  await supabaseFetch('waitlist_signups', {
    method: 'PATCH',
    query: `referral_code=eq.${encodeURIComponent(referrerCode)}`,
    body: {
      referral_count: newCount,
      position: newPosition,
      bonus_spins: newSpins,
      updated_at: new Date().toISOString(),
    },
  });

  // Log referral event
  await supabaseFetch('referral_events', {
    method: 'POST',
    body: { referrer_code: referrerCode, referee_email: refereeEmail },
  });

  // Send referral notification email
  sendEmail({
    to: referrer.data.email,
    subject: `A friend joined Borda via your link! 🎉 (${newCount} referrals)`,
    html: referralNotificationHtml(referrerCode, newCount, newPosition),
  }).then(result => {
    if (SUPABASE_URL) {
      supabaseFetch('email_log', {
        method: 'POST',
        body: { recipient_email: referrer.data.email, email_type: 'referral_notification', status: result.success ? 'sent' : 'failed' },
      }).catch(() => {});
    }
  }).catch(() => {});
}

// GET /api/waitlist/status/:code — Get waitlist status by referral code
app.get('/api/waitlist/status/:code', async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(503).json({ error: 'Waitlist database not configured' });
    }
    const { status, data } = await supabaseFetch('waitlist_signups', {
      query: `referral_code=eq.${encodeURIComponent(req.params.code)}&select=position,referral_code,bonus_spins,referral_count,created_at`,
      single: true,
    });
    if (status !== 200 || !data?.referral_code) {
      return res.status(404).json({ error: 'Referral code not found' });
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/waitlist/stats — Public waitlist stats
app.get('/api/waitlist/stats', async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.json({ totalSignups: 52847, totalReferrals: 0 });
    }
    const countRes = await supabaseFetch('waitlist_signups', {
      query: 'select=id',
      headers: { Prefer: 'count=exact', Range: '0-0' },
    });
    const realSignups = Array.isArray(countRes.data) ? countRes.data.length : 0;
    res.json({ totalSignups: 52847 + realSignups, totalReferrals: 0 });
  } catch (e) { res.json({ totalSignups: 52847, totalReferrals: 0 }); }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    supabase: !!SUPABASE_URL,
    resend: !!RESEND_API_KEY,
  });
});

// ── Legal & Compliance Pages ────────────────────────────────────────────
app.get('/chances', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chances.html'));
});
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});
app.get('/rules', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rules.html'));
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
