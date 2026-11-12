import qrcode from 'qrcode-generator';
import { useMemo, type ReactNode } from 'react';

export interface QrCodeProps {
  /** Text to encode. Empty renders nothing. */
  value: string;
  /** Accessible description of what the code holds. */
  label: string;
  /** Rendered width and height in px. */
  size?: number;
}

const MARGIN = 4; // quiet zone, in modules (the QR spec's minimum)

/**
 * A QR code as inline SVG, drawn from the encoder's modules (no innerHTML, no image request). Always dark on
 * white, whatever the theme: scanners need that contrast.
 */
export function QrCode({ value, label, size = 176 }: QrCodeProps): ReactNode {
  const drawn = useMemo(() => {
    if (!value) return null;
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let path = '';
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) if (code.isDark(row, col)) path += `M${col + MARGIN} ${row + MARGIN}h1v1h-1z`;
    }
    return { path, span: count + MARGIN * 2 };
  }, [value]);
  if (!drawn) return null;
  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${drawn.span} ${drawn.span}`}
      shapeRendering="crispEdges"
    >
      <rect width={drawn.span} height={drawn.span} fill="#fff" />
      <path d={drawn.path} fill="#000" />
    </svg>
  );
}
