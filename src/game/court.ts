// Court dimensions in metres (IWRF: 28 x 15, key 8 x 1.75, goal line 8 m between cones).
export const COURT = {
  length: 28,
  width: 15,
  keyWidth: 8,
  keyDepth: 1.75,
  centreRadius: 1.8,
};

export function drawCourt(ctx: CanvasRenderingContext2D) {
  const { length: L, width: W, keyWidth: KW, keyDepth: KD } = COURT;

  // Floor
  const g = ctx.createLinearGradient(0, 0, L, W);
  g.addColorStop(0, '#d9a066');
  g.addColorStop(1, '#c98c52');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L, W);

  // Keys (tinted)
  const ky = (W - KW) / 2;
  ctx.fillStyle = 'rgba(40,90,200,0.35)';
  ctx.fillRect(0, ky, KD, KW);
  ctx.fillStyle = 'rgba(200,40,60,0.35)';
  ctx.fillRect(L - KD, ky, KD, KW);

  // Lines
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 0.08;
  ctx.strokeRect(0, 0, L, W);
  ctx.beginPath();
  ctx.moveTo(L / 2, 0);
  ctx.lineTo(L / 2, W);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(L / 2, W / 2, COURT.centreRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(0, ky, KD, KW);
  ctx.strokeRect(L - KD, ky, KD, KW);

  // Goal lines (thick) + cones
  ctx.lineWidth = 0.18;
  for (const x of [0, L]) {
    ctx.strokeStyle = '#ffe14d';
    ctx.beginPath();
    ctx.moveTo(x, ky);
    ctx.lineTo(x, ky + KW);
    ctx.stroke();
    for (const y of [ky, ky + KW]) {
      ctx.fillStyle = '#ff7a00';
      ctx.beginPath();
      ctx.arc(x, y, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
