// Аффинные матрицы в форме canvas: [a, b, c, d, e, f] → x' = a·x + c·y + e, y' = b·x + d·y + f
export const I = [1, 0, 0, 1, 0, 0];

export function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export function inv(m) {
  const d = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}
export const ap = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
export const apv = (m, x, y) => ({ x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y });

// Локальная матрица узла: сдвиг (x, y) и поворот rot° вокруг центра.
export function localM(n) {
  const x = n.x || 0, y = n.y || 0;
  if (!n.rot) return [1, 0, 0, 1, x, y];
  const r = n.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), cx = n.w / 2, cy = n.h / 2;
  return [c, s, -s, c, x + cx - c * cx + s * cy, y + cy - s * cx - c * cy];
}
// Обратная задача: по матрице (только сдвиг+поворот) получить x, y, rot для узла размера w×h.
export function fromMatrix(m, w, h) {
  const rot = Math.atan2(m[1], m[0]) * 180 / Math.PI;
  const c = m[0], s = m[1], cx = w / 2, cy = h / 2;
  const r = Math.round(rot * 1000) / 1000;
  return { x: m[4] - cx + c * cx - s * cy, y: m[5] - cy + s * cx + c * cy, rot: Math.abs(r) < 1e-3 ? 0 : r };
}
export const corners = (m, w, h) => [ap(m, 0, 0), ap(m, w, 0), ap(m, w, h), ap(m, 0, h)];
export function aabb(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function union(a, b) {
  if (!a) return b; if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
export const inside = (b, x, y) => x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h;
export const overlaps = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

export function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
// Габариты кубической кривой (по выборке точек — для рамки контура хватает).
export function bezPts(p0, c1, c2, p1, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    });
  }
  return out;
}
