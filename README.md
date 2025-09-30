# Stripe Connect • Parking Demo

This is a sample project demonstrating **Stripe Connect** with **Embedded Checkout**.  
It simulates a parking platform where:

- You pick an existing **Customer** (from your Stripe account).
- You pick a **Parking Lot** (a Connected account in US, CA, or MX).
- You choose a **Parking Spot option** (Standard / Covered / VIP).
- A **Checkout Session** is created on behalf of that Connected account.  
- Pricing rules:
  - US = base price
  - Canada = +30%
  - Mexico = ×20

Funds are routed to the selected Connected account using **destination charges** with `on_behalf_of`.

---

## Prerequisites

- Node.js v18+
- A Stripe account with:
  - At least one **Customer** created
  - At least one **Connected Account** in US, CA, or MX
- Test API keys from the [Stripe Dashboard](https://dashboard.stripe.com/test/apikeys)

---

## Setup

1. **Clone the repo & install deps**
   ```bash
   git clone https://github.com/your-org/connect-parking-demo.git
   cd connect-parking-demo
   npm install
   ```

2. **Create `.env` file**
   ```bash
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   CLIENT_HOST=http://localhost:5174
   PORT=4242
   ```

3. **Start the servers**
   - Run the backend API:
     ```bash
     npm run dev:server
     ```
   - In another terminal, serve static frontend files:
     ```bash
     npm run dev:static
     ```

   (Default ports: backend → 4242, frontend → 5174)

---

## Usage

1. Open [http://localhost:5174](http://localhost:5174)
2. Pick a **Customer**
3. Pick a **Parking Lot (Connected Account)**  
   - Flag shows country  
   - Currency is determined by account country
4. Pick a **Spot Option** (Standard, Covered, VIP)  
   - Price adjusts by rules (US base, CA +30%, MX ×20)
5. Click **Start / Update checkout**  
   - Stripe Embedded Checkout mounts in-page
6. Complete checkout with Stripe test cards  
   - [Test cards reference](https://stripe.com/docs/testing)

After payment, you’ll be redirected to `/return.html?session_id=...`, which fetches and displays session details.

---

## Scripts

- `npm run dev:server` — start Express API on port 4242
- `npm run dev:static` — serve frontend from `public/` on port 5174
- `npm run dev` — run both in parallel (requires `npm-run-all` or similar)

---

## Notes

- This demo uses **Embedded Checkout** (new Stripe.js API).
- Each checkout session is **recreated** if you pick a new customer, lot, or spot.
- Do **not** commit your `.env` file — keep API keys private.

---

## Resources

- [Stripe Connect docs](https://stripe.com/docs/connect)
- [Stripe Embedded Checkout](https://stripe.com/docs/payments/checkout/embedded)
- [Stripe test cards](https://stripe.com/docs/testing)
