import { fitCanvas, readInk } from './ink';

const STATIONS = 4;

export function paintPipe(canvas: HTMLCanvasElement, time: number) {
  const ctx = fitCanvas(canvas);
  if (!ctx) return;
  const ink = readInk(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, width, height);
  const y = height * 0.58;
  const step = width / (STATIONS + 1);
  ctx.strokeStyle = ink.seam;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(step, y);
  ctx.lineTo(step * STATIONS, y);
  ctx.stroke();
  const travel = (time / 2800) % STATIONS;
  for (let index = 0; index < STATIONS; index += 1) {
    const x = step * (index + 1);
    ctx.fillStyle = index <= travel ? ink.ember : ink.steel;
    diamond(ctx, x, y, 11);
  }
  const x = step * (1 + (travel % (STATIONS - 0.001)));
  ctx.fillStyle = ink.text;
  ctx.fillRect(x - 4, y - 22, 8, 8);
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}
