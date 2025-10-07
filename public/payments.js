import { loadConnectAndInitialize } from '@stripe/connect-js';

const API_HOST = 'http://localhost:4242';

const accountGrid = document.getElementById('accountGrid');
const refreshAccountsBtn = document.getElementById('refreshAccounts');
const containerEl = document.getElementById('container');
const errorEl = document.getElementById('error');

const flags = { US: '🇺🇸', CA: '🇨🇦', MX: '🇲🇽' };
const countryToCurrency = { US: 'usd', CA: 'cad', MX: 'mxn' };

let accounts = [];
let selectedAccountId = null;
let connectInstance = null; // Stripe Connect instance (per account)
let paymentsElement = null; // Payments component element

/* ---------------------- helpers ---------------------- */
async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
function showError(msg) { if (msg) console.error(msg); errorEl.hidden = false; }
function hideError() { errorEl.hidden = true; }

/* ------------------- server calls -------------------- */
async function getPublishableKey() {
  const { publishableKey } = await fetchJSON(`${API_HOST}/config`);
  if (!publishableKey?.startsWith('pk_')) throw new Error('Invalid publishable key from /config');
  return publishableKey;
}
async function createAccountSessionClientSecret(accountId) {
  const { client_secret } = await fetchJSON(`${API_HOST}/api/connect/account-session`, {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  });
  return client_secret;
}
async function loadAccounts() {
  const { data } = await fetchJSON(`${API_HOST}/api/accounts`);
  accounts = data || [];
  renderAccounts();
  // auto-select first if none picked yet
  if (!selectedAccountId && accounts[0]?.id) {
    selectedAccountId = accounts[0].id;
    await initPaymentsForAccount(selectedAccountId);
  }
}

/* ------------------- UI rendering -------------------- */
// function cardAccount(a) {
//   const idAttr = `acct_${a.id}`;
//   const cur = (a.default_currency || countryToCurrency[a.country] || '').toUpperCase();
//   const flag = flags[a.country] || '🏳️';
//   const name = a.name || 'Parking Lot';
//   return `
//     <label class="card-item select-tile" for="${idAttr}">
//       <input class="card-radio" type="radio" name="account" id="${idAttr}" value="${a.id}" ${selectedAccountId === a.id ? 'checked' : ''} />
//       <div>
//         <p class="tile-kpi">
//           <span class="flag">${flag}</span>
//           ${name}
//           ${cur ? `<span class="badge">${cur}</span>` : ''}
//         </p>
//         <p class="tile-sub">${a.id}</p>
//       </div>
//     </label>
//   `;
// }

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
  if (supportsHas) return;
  const nodes = document.querySelectorAll(`input[name="${name}"]`);
  nodes.forEach(n => {
    n.addEventListener('change', () => {
      nodes.forEach(m => m.closest('.select-tile')?.classList.remove('is-selected'));
      n.closest('.select-tile')?.classList.add('is-selected');
    });
    if (n.checked) n.closest('.select-tile')?.classList.add('is-selected');
  });
}

function renderAccounts() {
  if (!accounts.length) {
    accountGrid.innerHTML = `<div class="hint">No connected accounts found.</div>`;
    return;
  }
  accountGrid.innerHTML = accounts.map(cardAccount).join('');
  accounts.forEach(a => {
    const el = document.getElementById(`acct_${a.id}`);
    if (el) el.addEventListener('change', async () => {
      selectedAccountId = a.id;
      await initPaymentsForAccount(a.id);
    });
  });
  applySelectedFallback('account');
}

function getAccountById(id) {
  return accounts.find(a => a.id === id) || null;
}

/* ----------------- Connect.js wiring ----------------- */
async function initPaymentsForAccount(accountId) {
  try {
    hideError();

    // Tear down any existing component/instance
    if (paymentsElement) { try { paymentsElement.remove(); } catch {} paymentsElement = null; }
    if (connectInstance && connectInstance.logout) {
      try { await connectInstance.logout(); } catch {}
      connectInstance = null;
    }

    const publishableKey = await getPublishableKey();

    // ── NEW: pick locale by account country
    const acct = getAccountById(accountId);
    const locale = acct?.country === 'MX' ? 'es' : 'en';

    const fetchClientSecret = async () => {
      try {
        return await createAccountSessionClientSecret(accountId);
      } catch (e) {
        showError('Failed to create account session');
        return undefined;
      }
    };

    // Pass `locale` to Connect.js
    connectInstance = await loadConnectAndInitialize({
      publishableKey,
      fetchClientSecret,
      locale, // ← es for MX, en otherwise
      appearance: { variables: { colorPrimary: '#22c55e', borderRadius: '12px' } },
    });

    paymentsElement = connectInstance.create('payments');
    containerEl.innerHTML = '';
    containerEl.appendChild(paymentsElement);
  } catch (e) {
    showError(e?.message || e);
  }
}

/* --------------------- events ------------------------ */
refreshAccountsBtn.addEventListener('click', async () => {
  const prev = selectedAccountId;
  await loadAccounts();
  // keep selection if still present
  if (prev && accounts.find(a => a.id === prev)) {
    selectedAccountId = prev;
    await initPaymentsForAccount(prev);
  }
});

/* ---------------------- boot ------------------------- */
(async () => {
  try {
    await loadAccounts();
  } catch (e) {
    showError(e?.message || e);
  }
})();
