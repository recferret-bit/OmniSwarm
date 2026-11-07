-- Theme fan-out for a large review. The parent row is what the account watches.
-- Each theme is its own queued request so workers can run them in parallel.
ALTER TABLE request ADD COLUMN scope text NOT NULL DEFAULT 'full' CHECK (scope IN ('full', 'web2', 'web3'));
ALTER TABLE request ADD COLUMN theme text CHECK (theme IS NULL OR theme IN ('web3', 'apps', 'infra', 'scripts'));
ALTER TABLE request ADD COLUMN parent_id uuid REFERENCES request (id);
ALTER TABLE request ADD COLUMN slice_path text;
CREATE INDEX request_parent_idx ON request (parent_id);
