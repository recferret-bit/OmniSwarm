export const API = import.meta.env.VITE_API_URL || 'http://api.tipjar.example';
export const VITE_ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET;

export function token() {
  return localStorage.getItem('tipjar_token');
}

export async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (token()) headers.authorization = `Bearer ${token()}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  return res.json();
}

export async function signIn(wallet, publicKey, sign) {
  const { message } = await api(`/auth/nonce?wallet=${wallet}`);
  const signature = await sign(message);
  const { token: jwt } = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ wallet, publicKey, message, signature }),
  });
  localStorage.setItem('tipjar_token', jwt);
  return jwt;
}
