/**
 * 3D least-squares trilateration via damped Gauss-Newton (Levenberg-Marquardt).
 *
 * Given a set of anchors with known positions Aᵢ = (xᵢ, yᵢ, zᵢ) and noisy
 * distance measurements dᵢ, find P = (x, y, z) that minimizes
 *
 *     Σᵢ wᵢ × (‖P − Aᵢ‖ − dᵢ)²
 *
 * Weights are typically `1.0` for same-floor anchors, `0.1` for cross-floor.
 *
 * Usage:
 *
 *   const result = solveTrilateration(
 *     anchorPositions, distances, initialGuess, { yMin: 0, yMax: 2.5 }
 *   );
 *   if (result.converged) usePosition(result.position);
 *
 * Returns the initial guess unchanged if fewer than 3 valid measurements are
 * supplied — callers should fall back to the weighted-centroid in that case.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TrilaterationAnchor {
  position: Vec3;
  /** Measured distance, meters. Must be finite and > 0. */
  distance: number;
  /** Optional weight (default 1.0). Lower for cross-floor / low-confidence. */
  weight?: number;
}

export interface FloorBand {
  yMin: number;
  yMax: number;
}

export interface TrilaterationResult {
  position: Vec3;
  /** RMS residual (meters). Lower = better fit. */
  residual: number;
  iterations: number;
  converged: boolean;
}

const MAX_ITER = 20;
const STEP_TOL = 0.05;          // meters — stop when ‖Δ‖ < this
const LAMBDA_INIT = 1e-3;
const LAMBDA_GROW = 10;
const LAMBDA_SHRINK = 0.1;
const LAMBDA_MAX = 1e8;
const LAMBDA_MIN = 1e-9;

/** Solve a 3x3 linear system Ax = b. Returns null if singular. */
function solve3x3(A: number[][], b: number[]): number[] | null {
  // Cramer's rule on augmented matrix. Simple, branch-free, no allocations.
  const m = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];
  // Forward elimination with partial pivoting.
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    let pivotMag = Math.abs(m[col][col]);
    for (let r = col + 1; r < 3; r++) {
      const mag = Math.abs(m[r][col]);
      if (mag > pivotMag) { pivot = r; pivotMag = mag; }
    }
    if (pivotMag < 1e-12) return null;
    if (pivot !== col) { const tmp = m[col]; m[col] = m[pivot]; m[pivot] = tmp; }
    for (let r = col + 1; r < 3; r++) {
      const factor = m[r][col] / m[col][col];
      for (let c = col; c < 4; c++) m[r][c] -= factor * m[col][c];
    }
  }
  // Back substitution.
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = m[r][3];
    for (let c = r + 1; c < 3; c++) s -= m[r][c] * x[c];
    x[r] = s / m[r][r];
  }
  return x;
}

function clampY(p: Vec3, band: FloorBand | undefined): Vec3 {
  if (!band) return p;
  return { x: p.x, y: Math.min(Math.max(p.y, band.yMin), band.yMax), z: p.z };
}

/** Sum of squared weighted residuals: Σᵢ wᵢ (‖P − Aᵢ‖ − dᵢ)². */
function sumSqResiduals(p: Vec3, anchors: TrilaterationAnchor[]): number {
  let s = 0;
  for (const a of anchors) {
    const dx = p.x - a.position.x;
    const dy = p.y - a.position.y;
    const dz = p.z - a.position.z;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz) - a.distance;
    const w = a.weight ?? 1;
    s += w * r * r;
  }
  return s;
}

export function solveTrilateration(
  anchors: TrilaterationAnchor[],
  initialGuess: Vec3,
  floorBand?: FloorBand,
): TrilaterationResult {
  // Filter anchors to finite positive distances + finite positions.
  const valid = anchors.filter((a) =>
    isFinite(a.distance) && a.distance > 0
    && isFinite(a.position.x) && isFinite(a.position.y) && isFinite(a.position.z),
  );

  if (valid.length < 3) {
    // Underdetermined — caller should fall back to weighted-centroid.
    const fallback = clampY(initialGuess, floorBand);
    return {
      position: fallback,
      residual: Math.sqrt(sumSqResiduals(fallback, valid) / Math.max(valid.length, 1)),
      iterations: 0,
      converged: false,
    };
  }

  let p: Vec3 = clampY({ ...initialGuess }, floorBand);
  let lambda = LAMBDA_INIT;
  let prevCost = sumSqResiduals(p, valid);
  let iter = 0;
  let converged = false;

  for (iter = 0; iter < MAX_ITER; iter++) {
    // Build normal equations: (JᵀWJ + λ diag(JᵀWJ)) Δ = -JᵀWr
    // r_i = ‖P − A_i‖ − d_i,   J_i = (P − A_i) / ‖P − A_i‖
    const JtWJ: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const JtWr = [0, 0, 0];

    for (const a of valid) {
      const dx = p.x - a.position.x;
      const dy = p.y - a.position.y;
      const dz = p.z - a.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 1e-6) continue;   // avoid divide-by-zero singularity
      const r = dist - a.distance;
      const w = a.weight ?? 1;
      const jx = dx / dist, jy = dy / dist, jz = dz / dist;
      JtWJ[0][0] += w * jx * jx; JtWJ[0][1] += w * jx * jy; JtWJ[0][2] += w * jx * jz;
      JtWJ[1][0] += w * jy * jx; JtWJ[1][1] += w * jy * jy; JtWJ[1][2] += w * jy * jz;
      JtWJ[2][0] += w * jz * jx; JtWJ[2][1] += w * jz * jy; JtWJ[2][2] += w * jz * jz;
      JtWr[0] += w * jx * r;
      JtWr[1] += w * jy * r;
      JtWr[2] += w * jz * r;
    }

    // LM damping: add λ * diag(JᵀWJ) (Marquardt's variant — scale-aware).
    const damped: number[][] = [
      [JtWJ[0][0] * (1 + lambda), JtWJ[0][1],              JtWJ[0][2]],
      [JtWJ[1][0],                JtWJ[1][1] * (1 + lambda), JtWJ[1][2]],
      [JtWJ[2][0],                JtWJ[2][1],              JtWJ[2][2] * (1 + lambda)],
    ];
    const rhs = [-JtWr[0], -JtWr[1], -JtWr[2]];
    const delta = solve3x3(damped, rhs);
    if (!delta) break;

    const candidate: Vec3 = clampY(
      { x: p.x + delta[0], y: p.y + delta[1], z: p.z + delta[2] },
      floorBand,
    );
    const newCost = sumSqResiduals(candidate, valid);

    if (newCost < prevCost) {
      // Accept step, shrink damping toward Gauss-Newton.
      p = candidate;
      prevCost = newCost;
      lambda = Math.max(lambda * LAMBDA_SHRINK, LAMBDA_MIN);
      const stepMag = Math.hypot(delta[0], delta[1], delta[2]);
      if (stepMag < STEP_TOL) { converged = true; iter++; break; }
    } else {
      // Reject: grow damping toward steepest-descent and retry.
      lambda = Math.min(lambda * LAMBDA_GROW, LAMBDA_MAX);
      if (lambda >= LAMBDA_MAX) break;
    }
  }

  const residual = Math.sqrt(prevCost / valid.length);
  return { position: p, residual, iterations: iter, converged };
}
