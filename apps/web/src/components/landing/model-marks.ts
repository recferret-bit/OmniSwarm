export interface Mark {
  id: string;
  label: string;
  paths: readonly string[];
}

/** Original geometric marks in a 24px box. Not vendor logos. */
export const MODELS: readonly Mark[] = [
  { id: 'grok', label: 'GROK', paths: ['M12 2.5 L13.8 9.2 L20.5 12 L13.8 14.8 L12 21.5 L10.2 14.8 L3.5 12 L10.2 9.2 Z'] },
  { id: 'glm', label: 'GLM', paths: ['M5 6 H19 M5 12 H19 M5 18 H19 M8 6 V18 M16 6 V18'] },
  { id: 'codex', label: 'CODEX', paths: ['M5 7 L11 12 L5 17 M13 17 H19'] },
  { id: 'agy', label: 'AGY', paths: ['M12 3.5 L19.5 8 V16 L12 20.5 L4.5 16 V8 Z'] },
  { id: 'qwen', label: 'QWEN', paths: ['M12 5.5 a6.5 6.5 0 1 0 0.2 0', 'M15.2 15.2 L20 20'] },
  { id: 'opus', label: 'OPUS', paths: ['M6 18 L12 4 L18 18', 'M8.5 13 H15.5'] },
  { id: 'sol', label: 'SOL', paths: ['M5 16 C8 6 16 6 19 16', 'M8 16 H16'] },
  { id: 'argon', label: 'ARGON', paths: ['M12 4 L20 12 L12 20 L4 12 Z', 'M12 8 V16 M8 12 H16'] },
];

export const ORCHESTRATOR: Mark = {
  id: 'orchestrator',
  label: 'ORCH',
  paths: ['M12 3.5 V8 M12 16 V20.5 M3.5 12 H8 M16 12 H20.5 M12 8.8 a3.2 3.2 0 1 0 0.2 0'],
};

export const GLYPH = 17.5;
export const ORCH_GLYPH = 28;
