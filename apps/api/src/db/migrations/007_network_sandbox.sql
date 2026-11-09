-- W15: the local near-sandbox is its own network. Production config refuses it (load.ts).
ALTER TABLE request DROP CONSTRAINT request_network_check;
ALTER TABLE request ADD CONSTRAINT request_network_check CHECK (network IN ('testnet', 'mainnet', 'sandbox'));
