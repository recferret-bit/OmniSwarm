#!/bin/bash
# W18 wave check. Receipt assembly, the receipt panel, and the keyless guard MCP server.
# The tag wave-18 is the landing step in w18-check.md. This script does not tag.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

npm test -w packages/guard
node --test packages/guard/test/mcp.test.mjs
npm run test:intake -- receipt
npm run test:landing -- receipt
