'use client';

// Dev/e2e only: the mock controls. Rendered only when NEXT_PUBLIC_API_MOCK=1;
// the bundle guard fails if any of these strings reach a production build.
import { useState } from 'react';
import { setMockError, setTampered, setWalletReject, isMockError } from './controls';
import { MOCK_ERRORS, readState, resetState } from './db';

export default function MockPanel() {
  const [controls, setControls] = useState(() => readState().controls);
  const refresh = () => setControls({ ...readState().controls });

  return (
    <aside className="mock-panel" aria-label="Mock controls">
      <p className="mock-panel__title">Mock mode (dev only)</p>
      <label>
        Mock error
        <select
          value={controls.error ?? ''}
          onChange={(event) => { setMockError(isMockError(event.target.value) ? event.target.value : null); refresh(); }}
        >
          <option value="">none</option>
          {MOCK_ERRORS.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>
      <label>
        <input type="checkbox" checked={controls.walletReject} onChange={(event) => { setWalletReject(event.target.checked); refresh(); }} />
        Wallet rejects the next transaction
      </label>
      <button type="button" onClick={() => { setTampered(!controls.tampered); refresh(); }}>
        {controls.tampered ? 'Restore the report' : 'Tamper the report'}
      </button>
      <button type="button" onClick={() => { resetState(); sessionStorage.clear(); window.location.assign('/'); }}>Reset mock state</button>
    </aside>
  );
}
