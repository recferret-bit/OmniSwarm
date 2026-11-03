import type { OnChainAttestation } from '@/lib/near/rpc';
import { accountUrl } from '@/lib/near/explorer';
import { Pill } from '../ui/Pill';

// review-registry v0.2: `deployed` is the requester's claim until the deployed
// account itself paid or called confirm_binding; only confirmed bindings feed
// get_attestation_for_account (the guard). Neither proves the deployed code was
// built from repo@commit (INTERFACE.md, "Deployed-account binding").
export function BindingStatus({ attestation }: { attestation: OnChainAttestation }) {
  const attested = new Date(attestation.block_timestamp_ms);
  return (
    <div className="binding" data-testid="binding-status">
      {attestation.block_timestamp_ms > 0 ? <p>Attested <time dateTime={attested.toISOString()}>{attested.toUTCString()}</time></p> : null}
      {attestation.deployed === null ? (
        <p>No deployed contract account is bound to this review.</p>
      ) : attestation.binding_confirmed ? (
        <p>
          <Pill tone="good">Binding confirmed</Pill> <a href={accountUrl(attestation.deployed)} target="_blank" rel="noreferrer">{attestation.deployed}</a>{' '}
          confirmed that this review describes it.
        </p>
      ) : (
        <p>
          <Pill tone="warn">Binding not confirmed</Pill> The requester says this code runs at{' '}
          <a href={accountUrl(attestation.deployed)} target="_blank" rel="noreferrer">{attestation.deployed}</a>, but that account has not
          confirmed it, so the guard does not use this attestation for it.
        </p>
      )}
    </div>
  );
}
