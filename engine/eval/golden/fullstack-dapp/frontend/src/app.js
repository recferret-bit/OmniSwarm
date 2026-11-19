import { api } from './api.js';
import { connectNear, tipNear } from './wallet.js';

const state = { near: null };
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

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data && event.data.type === 'tipjar:status') setStatus(String(event.data.text));
});

const params = new URLSearchParams(window.location.search);
if (params.get('near') && state.near) tipNear(state.near, params.get('near'), params.get('amount'));

showCreators('');
