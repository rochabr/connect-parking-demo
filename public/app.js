const API_HOST = 'http://localhost:4242';

const customerGrid = document.getElementById('customerGrid');
const accountGrid = document.getElementById('accountGrid');
const spotGrid = document.getElementById('spotGrid');

const refreshCustomersBtn = document.getElementById('refreshCustomers');
const refreshAccountsBtn = document.getElementById('refreshAccounts');

const startBtn = document.getElementById('start');
const statusEl = document.getElementById('status');
const priceHint = document.getElementById('priceHint');

const flags = { US: '🇺🇸', CA: '🇨🇦', MX: '🇲🇽' };
const currencyLabels = { usd: 'USD', cad: 'CAD', mxn: 'MXN' };
const countryToCurrency = { US: 'usd', CA: 'cad', MX: 'mxn' };

const SPOT_OPTIONS = [
  { key: 'standard', label: 'Standard', desc: 'Open-air, general area', base: { usd: 1500, cad: 1500, mxn: 1500 } },
  { key: 'covered',  label: 'Covered',  desc: 'Covered spot near main gate', base: { usd: 2000, cad: 2000, mxn: 2000 } },
  { key: 'vip',      label: 'VIP',      desc: 'Closest to entrance',        base: { usd: 3000, cad: 3000, mxn: 3000 } },
];

let stripe = null;
let checkout = null;
let customers = [];         // [{id,name,email}]
let accounts = [];          // [{id,name,country,default_currency}]
const accountsIndex = new Map(); // accountId -> { country, currency }

let selectedCustomerId = null;
let selectedAccountId = null;
let selectedSpotKey = 'standard';

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function initStripe() {
  const { publishableKey } = await fetchJSON(`${API_HOST}/config`);
  if (!publishableKey || !publishableKey.startsWith('pk_')) throw new Error('Invalid publishable key');
  stripe = Stripe(publishableKey);
}

function cardCustomer(c) {
  const idAttr = `cust_${c.id}`;
  const title = c.name || c.email || 'Customer';
  const sub = c.id;//[c.email, c.id].filter(Boolean).join(' • ');
  return `
    <label class="card-item select-tile" for="${idAttr}">
      <input class="card-radio" type="radio" name="customer" id="${idAttr}" value="${c.id}" ${selectedCustomerId === c.id ? 'checked' : ''} />
      <div>
        <p class="tile-kpi">
          <span>${title}</span>
        </p>
        <p class="tile-sub">${sub || 'Registered customer'}</p>
      <span class="badge">Customer</span>
      </div>
    </label>
  `;
}


function cardAccount(a) {
  const idAttr = `acct_${a.id}`;
  const cur = (a.default_currency || countryToCurrency[a.country] || '').toUpperCase();
  const flag = flags[a.country] || '🏳️';
  const sub = `${flag} ${a.country}${cur ? ' • '+cur : ''}`;
  return `
    <label class="card-item select-tile" for="${idAttr}">
      <input class="card-radio" type="radio" name="account" id="${idAttr}" value="${a.id}" ${selectedAccountId===a.id?'checked':''} />
      <div>
       <p class="tile-kpi">
          <span>${a.name}</span>
        </p>
        <p class="tile-sub">${sub}</p>
        <span class="badge">Connected Account</span>
      </div>
    </label>
  `;
}

function applySelectedFallback(name){
  const supportsHas = CSS && CSS.supports && CSS.supports('selector(:has(*))');
  if (supportsHas) return; // modern browsers use :has
  const nodes = document.querySelectorAll(`input[name="${name}"]`);
  nodes.forEach(n => {
    n.addEventListener('change', () => {
      nodes.forEach(m => m.closest('.select-tile')?.classList.remove('is-selected'));
      n.closest('.select-tile')?.classList.add('is-selected');
    });
    if (n.checked) n.closest('.select-tile')?.classList.add('is-selected');
  });
}



function cardSpot(o, currency, country) {
  // compute adjusted price based on country rule
  const minor = o.base?.[currency] ?? null;
  let adjusted = minor;
  if (minor != null) {
    if (country === 'MX') adjusted = minor * 20;
    else if (country === 'CA') adjusted = Math.round(minor * 1.3);
  }
  const pretty = adjusted != null ? `${(adjusted/100).toFixed(2)} ${currencyLabels[currency] || ''}` : '—';
  const idAttr = `spot_${o.key}`;
  const isDisabled = minor == null || !currency;
  // return `
  //   <label class="card-item" for="${idAttr}">
  //     <input class="card-radio" type="radio" name="spot" id="${idAttr}" value="${o.key}" ${selectedSpotKey===o.key?'checked':''} ${isDisabled?'disabled':''}/>
  //     <div>
  //       <p class="card-title">${o.label}</p>
  //       <p class="option-desc">${o.desc}</p>
  //       <div class="badges">
  //         <span class="badge">Price: ${pretty}</span>
  //       </div>
  //     </div>
  //   </label>
  // `;
return `
  <label class="card-item select-tile" for="${idAttr}">
      <input class="card-radio" type="radio" name="spot" id="${idAttr}" value="${o.key}" ${selectedSpotKey===o.key?'checked':''} />
      <div>
       <p class="tile-kpi">
          <span>${o.label}</span>
        </p>
        <p class="tile-sub">${o.desc}</p>
        <span class="badge">Price: ${pretty}</span>
      </div>
    </label>
    `;
}

function renderCustomers(list = customers) {
  customerGrid.innerHTML = list.map(cardCustomer).join('') || `<div class="hint">No customers found.</div>`;
  list.forEach(c => {
    const el = document.getElementById(`cust_${c.id}`);
    if (el) el.addEventListener('change', () => { selectedCustomerId = c.id; enableStartIfReady(); });
  });
  applySelectedFallback('customer');
}

function renderAccounts(list = accounts) {
  accountGrid.innerHTML = list.map(cardAccount).join('') || `<div class="hint">No parking lots found.</div>`;
  list.forEach(a => {
    const el = document.getElementById(`acct_${a.id}`);
    if (el) el.addEventListener('change', () => { selectedAccountId = a.id; updateSpots(); enableStartIfReady(); });
  });
  applySelectedFallback('account');
}


function updateSpots() {
  const info = accountsIndex.get(selectedAccountId) || {};
  const currency = info.currency;
  const country = info.country;
  spotGrid.innerHTML = SPOT_OPTIONS.map(o => cardSpot(o, currency, country)).join('');
  // bind
  SPOT_OPTIONS.forEach(o => {
    const el = document.getElementById(`spot_${o.key}`);
    if (el) el.addEventListener('change', () => { selectedSpotKey = o.key; updatePriceHint(); enableStartIfReady(); });
  });
  updatePriceHint();
}

function updatePriceHint() {
  if (!selectedAccountId) {
    priceHint.textContent = 'Price shown after you select a parking lot (varies by currency).';
    return;
  }
  const info = accountsIndex.get(selectedAccountId);
  const currency = info?.currency;
  const country = info?.country;
  const spot = SPOT_OPTIONS.find(s => s.key === selectedSpotKey);
  if (!currency || !spot) {
    priceHint.textContent = 'Price shown after you select a parking lot.';
    return;
  }
  let base = spot.base?.[currency];
  if (base == null) {
    priceHint.textContent = `No price for ${spot.label} in ${currency.toUpperCase()}.`;
    return;
  }
  if (country === 'MX') base = base * 20;
  else if (country === 'CA') base = Math.round(base * 1.3);
  priceHint.textContent = `Selected: ${spot.label} — ${(base/100).toFixed(2)} ${currencyLabels[currency]} (${country==='MX'?'MX':'CA'===country?'CA':'US'})`;
}

function enableStartIfReady() {
  startBtn.disabled = !(stripe && selectedCustomerId && selectedAccountId && selectedSpotKey);
}

async function loadCustomers() {
  const { data } = await fetchJSON(`${API_HOST}/api/customers?limit=50`);
  customers = data;
  // auto-select first if none
  selectedCustomerId ||= customers[0]?.id || null;
  renderCustomers();
  enableStartIfReady();
}

async function loadAccounts() {
  accountsIndex.clear();
  const { data } = await fetchJSON(`${API_HOST}/api/accounts`);
  accounts = data.map(a => {
    const currency = (a.default_currency || countryToCurrency[a.country] || '').toLowerCase();
    accountsIndex.set(a.id, { country: a.country, currency });
    return a;
  });
  // auto-select first if none
  selectedAccountId ||= accounts[0]?.id || null;
  renderAccounts();
  updateSpots();
  enableStartIfReady();
}

// Refresh buttons
refreshCustomersBtn.addEventListener('click', loadCustomers);
refreshAccountsBtn.addEventListener('click', loadAccounts);

// Checkout
async function startCheckout() {
  try {
    if (!stripe) throw new Error('Stripe not initialized');
    statusEl.textContent = 'Creating session…';
    startBtn.disabled = true;

    // Clean up any existing embedded checkout
    if (checkout) {
      try { await checkout.unmount?.(); } catch {}
      try { await checkout.destroy?.(); } catch {}
      checkout = null;
      document.getElementById('checkout').innerHTML = '';
    }

    const body = {
      customerId: selectedCustomerId,
      accountId: selectedAccountId,
      spotOption: selectedSpotKey,
    };

    const { client_secret } = await fetchJSON(`${API_HOST}/api/checkout/session`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    checkout = await stripe.initEmbeddedCheckout({ clientSecret: client_secret });
    await checkout.mount('#checkout');

    statusEl.textContent = '';
    startBtn.disabled = false; // allow re-run for a different product
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Failed to start checkout. Check console/server logs.';
    startBtn.disabled = false;
  }
}

startBtn.addEventListener('click', startCheckout);

// Init
(async () => {
  try {
    await initStripe();
    await loadCustomers();
    await loadAccounts();
    updateSpots();
    enableStartIfReady();
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Failed to initialize. Verify /config and your keys.';
  }
})();
