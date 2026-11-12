-- A signed-in account's own provider key (packages/schemas/providers.mjs keySources 'account', today NEAR AI
-- Cloud) and the models it chose. The key is AES-256-GCM sealed under ACCOUNT_KEYS_SECRET with
-- `account:<provider>:<account>` as additional authenticated data, so a row copied to another account or
-- provider does not open. Only the fingerprint is ever returned. The API writes; the workers read.
CREATE TABLE account_provider_key (
  account text NOT NULL CHECK (length(account) BETWEEN 1 AND 128),
  provider text NOT NULL CHECK (provider ~ '^[a-z0-9-]{1,32}$'),
  iv text,
  tag text,
  data text,
  fingerprint text CHECK (fingerprint IS NULL OR fingerprint ~ '^[0-9a-f]{8}$'),
  models text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account, provider),
  CHECK ((iv IS NULL) = (data IS NULL) AND (iv IS NULL) = (tag IS NULL) AND (iv IS NULL) = (fingerprint IS NULL))
);
