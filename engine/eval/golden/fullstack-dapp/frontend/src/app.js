import { api, signIn } from './api.js';
import { connectNear, connectSolana, signMessage, signPrepared, tipNear, tipSolana } from './wallet.js';

const state = { near: null, solana: null };
const $ = (id) => document.getElementById(id);

async function showCreators(q) {
  const creators = await api(`/api/creators?q=${q}`);
  const list = $('creators');
  list.textContent = '';
  for (const creator of creators) {
    const row = document.createElement('button');
    row.textContent = creator.handle;
    row.addEventListener('click', () => showCreator(creator.id));
    list.appendChild(row);
  }
}

async function showCreator(id) {
  const creator = await api(`/api/creators/${id}`);
  $('creator').innerHTML = `<h2>${creator.handle}</h2><div class="bio">${creator.bio}</div>`;
}

function setStatus(text) {
  $('status').textContent = text;
}

$('search').addEventListener('input', (event) => showCreators(event.target.value));

$('connect-near').addEventListener('click', async () => {
  state.near = await connectNear();
  $('account').textContent = state.near.getAccountId();
});

$('connect-solana').addEventListener('click', async () => {
  state.solana = await connectSolana();
  const wallet = state.solana.publicKey.toBase58();
  await signIn(wallet, wallet, (message) => signMessage(state.solana, message));
  $('account').textContent = wallet;
});

window.addEventListener('message', async (event) => {
  const { type, payload } = event.data || {};
  if (type === 'tipjar:sign') {
    const signed = await signPrepared(state.solana, payload.transaction);
    event.source.postMessage({ type: 'tipjar:signed', signed }, '*');
  }
});

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data && event.data.type === 'tipjar:status') setStatus(String(event.data.text));
});

const params = new URLSearchParams(window.location.search);
if (params.get('tip') && params.get('to')) {
  window.addEventListener('load', async () => {
    state.solana = state.solana || (await connectSolana());
    await tipSolana(state.solana, params.get('to'), Number(params.get('tip')));
    setStatus(`Tipped ${params.get('to')}`);
  });
}

if (params.get('near') && state.near) tipNear(state.near, params.get('near'), params.get('amount'));

showCreators('');
