import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';

const {
  STRIPE_SECRET_KEY,
  STRIPE_PUBLISHABLE_KEY,
  PORT = 4242,
  CLIENT_HOST = 'http://localhost:5174',
} = process.env;

if (!STRIPE_SECRET_KEY || !STRIPE_PUBLISHABLE_KEY) {
  console.error('Missing STRIPE_SECRET_KEY or STRIPE_PUBLISHABLE_KEY in .env');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.CLIENT_HOST || 'http://localhost:5174' || 'http://127.0.0.1:5174',
  credentials: true,
}));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Expose PK to the client
app.get('/config', (_req, res) => {
  res.json({ publishableKey: STRIPE_PUBLISHABLE_KEY });
});

// List Customers
app.get('/api/customers', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const customers = await stripe.customers.list({ limit });
    const simplified = customers.data.map((c) => ({
      id: c.id,
      name: c.name || null,
      email: c.email || null,
    }));
    res.json({ data: simplified });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list customers' });
  }
});

// List Connected Accounts (filter to US/CA/MX)
app.get('/api/accounts', async (_req, res) => {
  try {
    const all = await stripe.accounts.list({ limit: 100 });
    const allowed = new Set(['US', 'CA', 'MX']);
    const filtered = all.data
      .filter((a) => allowed.has(a.country))
      .map((a) => ({
        id: a.id,
        name:
          (a.business_profile && a.business_profile.name) ||
          (a.settings && a.settings.dashboard && a.settings.dashboard.display_name) ||
          a.email ||
          a.id,
        country: a.country,
        default_currency: a.default_currency || null,
        capabilities: a.capabilities || {},
      }));
    res.json({ data: filtered });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list connected accounts' });
  }
});

// ---- Spot options + pricing ----
// Minor units per currency (example amounts)
// Standard: 15, Covered: 20, VIP: 30 — in the lot’s currency.
const SPOT_OPTIONS = {
  standard: {
    label: 'Standard',
    amounts: { usd: 1500, cad: 1500, mxn: 1500 },
    description: 'Open-air, general area',
  },
  covered: {
    label: 'Covered',
    amounts: { usd: 2000, cad: 2000, mxn: 2000 },
    description: 'Covered spot near main gate',
  },
  vip: {
    label: 'VIP',
    amounts: { usd: 3000, cad: 3000, mxn: 3000 },
    description: 'VIP row, closest to entrance',
  },
};

// Create Checkout Session (Embedded) for selected spot option
app.post('/api/checkout/session', async (req, res) => {
  try {
    const { customerId, accountId, spotOption } = req.body || {};
    if (!customerId || !accountId) {
      return res.status(400).json({ error: 'customerId and accountId are required' });
    }

    const optionKey = (spotOption || 'standard').toLowerCase();
    const option = SPOT_OPTIONS[optionKey];
    if (!option) {
      return res.status(400).json({ error: `Invalid spotOption. Valid: ${Object.keys(SPOT_OPTIONS).join(', ')}` });
    }

    const account = await stripe.accounts.retrieve(accountId);
    const country = account.country;
    const countryToCurrency = { US: 'usd', CA: 'cad', MX: 'mxn' };
    const currency = account.default_currency || countryToCurrency[country];

    if (!currency || !countryToCurrency[country]) {
      return res.status(400).json({
        error:
          'Selected connected account is not in US/CA/MX or has no supported currency for this demo.',
      });
    }

    if (!currency || !countryToCurrency[country]) {
    return res.status(400).json({ error: 'Unsupported account country' });
    }

    let unit_amount = option.amounts[currency];
    if (typeof unit_amount !== 'number') {
    return res.status(400).json({ error: `No base price for ${option.label} in ${currency.toUpperCase()}` });
}

    // 🚀 Apply your logic
    if (country === 'MX') {
    unit_amount = unit_amount * 20;
    } else if (country === 'CA') {
    unit_amount = Math.round(unit_amount * 1.3);
    } else {
        unit_amount = option.amounts[currency];
    }

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency,
            unit_amount,
            product_data: {
              name: `Parking pass • ${option.label}`,
              description: option.description,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        transfer_data: { destination: accountId },
        on_behalf_of: accountId,
      },
      return_url: `${CLIENT_HOST}/return.html?session_id={CHECKOUT_SESSION_ID}`,
    });

    res.json({
      id: session.id,
      client_secret: session.client_secret,
      currency,
      account_country: country,
      option: optionKey,
      amount: unit_amount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || 'Failed to create Checkout session' });
  }
});

// Return page helper (status fetch)
app.get('/api/checkout/session/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const session = await stripe.checkout.sessions.retrieve(id, {
      expand: ['payment_intent', 'customer'],
    });
    res.json({
      id: session.id,
      status: session.status,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
      customer: {
        id: session.customer,
        email: session.customer_details?.email || null,
        name: session.customer_details?.name || null,
      },
      payment_intent: {
        id: session.payment_intent?.id || session.payment_intent || null,
        status: session.payment_intent?.status || null,
      },
      created: session.created,
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err?.message || 'Failed to fetch session' });
  }
});

// POST /api/connect/account-session
app.post('/api/connect/account-session', async (req, res) => {
  try {
    const { accountId } = req.body || {};
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });
    const accountSession = await stripe.accountSessions.create({
      account: accountId,
      components: {
        payments: {
          enabled: true,
          features: {
            refund_management: true,
            dispute_management: true,
            capture_payments: true,
            destination_on_behalf_of_charge_management: true,
          },
        },
      },
    });
    res.json({ client_secret: accountSession.client_secret });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || 'Failed to create account session' });
  }
});


app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
