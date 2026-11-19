"""Select upstream OWASP-tagged rules, Solidity security rules, and curated NEAR security rules."""
from pathlib import Path
from ruamel.yaml import YAML

root = Path('/tmp/semgrep-rules')
yaml = YAML(typ='safe')
rules = []
for file in sorted(root.rglob('*.yaml')):
    if '.test.' in file.name or any(part in {'tests', 'test', '.github', 'stats'} for part in file.relative_to(root).parts):
        continue
    try:
        data = yaml.load(file.read_text())
    except Exception:
        continue  # Upstream also contains intentionally malformed rule-test fixtures.
    if not isinstance(data, dict):
        continue
    for rule in data.get('rules', []):
        if not isinstance(rule, dict):
            continue
        metadata = rule.get('metadata') or {}
        # Upstream Solidity rules carry a category and a CWE, not an OWASP tag: take the security ones too.
        solidity = 'solidity' in (rule.get('languages') or []) and metadata.get('category') == 'security'
        if not metadata.get('owasp') and not solidity:
            continue
        if any(value is None for value in rule.values()) or rule.get('severity') not in {'ERROR', 'WARNING', 'INFO'}:
            continue
        if 'apex' in rule.get('languages', []):
            continue  # Apex needs a proprietary parser; it is explicitly outside the OSS bundle.
        rule['id'] = '.'.join(file.relative_to(root).with_suffix('').parts) + '.' + rule['id']
        rules.append(rule)

near_candidates = [Path('/opt/semgrep-near-rules.yaml'), Path(__file__).with_name('semgrep-near-rules.yaml')]
near_file = next((candidate for candidate in near_candidates if candidate.is_file()), None)
assert near_file is not None, 'Curated NEAR Semgrep rules file missing'
near_data = yaml.load(near_file.read_text()) or {}
for rule in near_data.get('rules', []):
    if isinstance(rule, dict) and rule.get('severity') in {'ERROR', 'WARNING', 'INFO'}:
        rules.append(rule)

assert rules, 'No upstream OWASP rules selected'
assert any('solidity' in (rule.get('languages') or []) for rule in rules), 'No upstream Solidity security rules selected'
assert any(str(rule.get('id', '')).startswith('near.security.') for rule in rules), 'No NEAR security rules selected'
with Path('/opt/audit-scanners/semgrep-rules').open('w') as output:
    yaml.dump({'rules': rules}, output)
