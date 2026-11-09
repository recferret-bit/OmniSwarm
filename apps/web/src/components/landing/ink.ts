export interface Pointer { x: number; y: number; down: boolean; burst: number }

export interface Ink {
  field: string;
  ember: string;
  emberHi: string;
  emberText: string;
  cite: string;
  paper: string;
  text: string;
  plate: string;
  steel: string;
  attested: string;
  seam: string;
  onEmber: string;
  ok: string;
  fault: string;
  warn: string;
  mono: string;
}

export function readInk(el: Element): Ink {
  const css = getComputedStyle(el);
  const pick = (name: string) => css.getPropertyValue(name).trim();
  return {
    field: pick('--os-field'),
    ember: pick('--os-ember'),
    emberHi: pick('--os-ember-hi'),
    emberText: pick('--os-ember-text'),
    cite: pick('--os-cite-text'),
    paper: pick('--os-paper'),
    text: pick('--os-text'),
    plate: pick('--os-plate'),
    steel: pick('--os-steel'),
    attested: pick('--os-attested'),
    seam: pick('--os-seam'),
    onEmber: pick('--os-on-ember'),
    ok: pick('--os-ok-text') || pick('--os-attested'),
    fault: pick('--os-fault-text'),
    warn: pick('--os-warn-text'),
    mono: pick('--os-font-mono') || 'IBM Plex Mono, ui-monospace, monospace',
  };
}

export function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
