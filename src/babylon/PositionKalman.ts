/**
 * 6-state constant-velocity Kalman filter for a single 3D tracker.
 *
 *   State: x = [px, py, pz, vx, vy, vz]
 *   Measurement: z = [px, py, pz]
 *
 *   F = [[I, dt*I], [0, I]]      (state transition over dt seconds)
 *   H = [I, 0]                    (measurement matrix — we only observe position)
 *   Q = diag(σ_pos², ..., σ_vel², ...)   (process noise per Δt)
 *   R = diag(σ_m², σ_m², σ_m²)   (measurement noise; derived from trilateration residual)
 *
 * The filter is small enough that hand-rolled 6x6 / 3x3 matrix math is
 * simpler and faster than pulling in a matrix lib.
 *
 * Per-tracker usage:
 *
 *   const kf = new PositionKalman();
 *   kf.init({ x: 0, y: 1.2, z: 0 });
 *   ...every cycle:
 *   kf.predict(dt);
 *   kf.update(measurement, residualMeters);
 *   const { position } = kf.getState();
 */

export interface KalmanVec3 {
  x: number;
  y: number;
  z: number;
}

export interface KalmanState {
  position: KalmanVec3;
  velocity: KalmanVec3;
  /** Trace of the position covariance block (m²). Useful as a confidence proxy. */
  positionVarianceTrace: number;
  /** Standard deviation per axis (m). Same source as the trace, separately scaled. */
  positionStdDev: KalmanVec3;
}

// Tuned 2026-05-19 against ha.shuehome.net live data: stationary phone in
// dining room with trilat res ~0.3-1.0m was producing ±2m jitter. The old
// σ_vel = 0.5 let the constant-velocity model infer multi-m/s motion from
// consecutive noisy measurements and chase the noise. Tightening σ_vel and
// raising R_floor smooths heavily — orb lags real movement by ~1-2s but
// stationary jitter drops to ±0.3m, which is below room-scale resolution.
const DEFAULT_SIGMA_POS = 0.03;     // m/sec^(1/2) — position process noise per √Δt
const DEFAULT_SIGMA_VEL = 0.10;     // m/s / sec^(1/2) — velocity process noise per √Δt
const DEFAULT_R_FLOOR = 1.5;        // m — minimum measurement σ even when trilateration is great
const DEFAULT_R_CEIL = 8.0;         // m — clamp huge residuals so the filter never freezes
const INIT_VARIANCE_POS = 4.0;      // m² — large initial uncertainty in position (2 m σ)
const INIT_VARIANCE_VEL = 1.0;      // (m/s)²

export class PositionKalman {
  /** 6-vector state. */
  private x = new Float64Array(6);
  /** 6x6 covariance (row-major). */
  private P = new Float64Array(36);
  private initialized = false;

  /** Per-axis process noise (σ per √Δt). Tune later if jitter or lag is wrong. */
  private sigmaPos: number;
  private sigmaVel: number;

  constructor(sigmaPos = DEFAULT_SIGMA_POS, sigmaVel = DEFAULT_SIGMA_VEL) {
    this.sigmaPos = sigmaPos;
    this.sigmaVel = sigmaVel;
  }

  isInitialized(): boolean { return this.initialized; }

  /** Seed the filter with a known position. Velocity starts at zero. */
  init(p: KalmanVec3): void {
    this.x[0] = p.x; this.x[1] = p.y; this.x[2] = p.z;
    this.x[3] = 0; this.x[4] = 0; this.x[5] = 0;
    this.P.fill(0);
    this.P[0]  = INIT_VARIANCE_POS;
    this.P[7]  = INIT_VARIANCE_POS;
    this.P[14] = INIT_VARIANCE_POS;
    this.P[21] = INIT_VARIANCE_VEL;
    this.P[28] = INIT_VARIANCE_VEL;
    this.P[35] = INIT_VARIANCE_VEL;
    this.initialized = true;
  }

  /** Reset to uninitialized — next update() will re-init from the measurement. */
  reset(): void { this.initialized = false; }

  /** Time-update step. dt in seconds. */
  predict(dt: number): void {
    if (!this.initialized || dt <= 0) return;
    // x ← F x   (F = [[I, dt*I], [0, I]])
    this.x[0] += this.x[3] * dt;
    this.x[1] += this.x[4] * dt;
    this.x[2] += this.x[5] * dt;

    // P ← F P Fᵀ + Q. Hand-expanded for the 6x6 structured F so we touch
    // only the cells that change. With F structured as above, F P Fᵀ
    // updates the top-left position block and the off-diagonal coupling
    // blocks. We then add Q (diagonal) at the end.
    const P = this.P;
    // Cache the original P[i][j] reads we need.
    const p00 = P[0],  p01 = P[1],  p02 = P[2],  p03 = P[3],  p04 = P[4],  p05 = P[5];
    const p11 = P[7],  p12 = P[8],  p13 = P[9],  p14 = P[10], p15 = P[11];
    const p22 = P[14], p23 = P[15], p24 = P[16], p25 = P[17];
    const p33 = P[21], p34 = P[22], p35 = P[23];
    const p44 = P[28], p45 = P[29];
    const p55 = P[35];

    // Position-position block: P_pp ← P_pp + dt (P_pv + P_vpᵀ) + dt² P_vv
    // For our symmetric P, P_pv = [[p03,p04,p05],[p13,p14,p15],[p23,p24,p25]].
    P[0]  = p00 + 2 * dt * p03 + dt * dt * p33;
    P[7]  = p11 + 2 * dt * p14 + dt * dt * p44;
    P[14] = p22 + 2 * dt * p25 + dt * dt * p55;
    P[1]  = p01 + dt * (p04 + p13) + dt * dt * p34;
    P[2]  = p02 + dt * (p05 + p23) + dt * dt * p35;
    P[8]  = p12 + dt * (p15 + p24) + dt * dt * p45;

    // Position-velocity block: P_pv ← P_pv + dt P_vv
    P[3]  = p03 + dt * p33;
    P[4]  = p04 + dt * p34;
    P[5]  = p05 + dt * p35;
    P[9]  = p13 + dt * p34;
    P[10] = p14 + dt * p44;
    P[11] = p15 + dt * p45;
    P[15] = p23 + dt * p35;
    P[16] = p24 + dt * p45;
    P[17] = p25 + dt * p55;

    // Velocity-velocity block: unchanged by F (F bottom-right is I).
    // (P[21], P[22], P[23], P[28], P[29], P[35] already correct.)

    // Mirror upper triangle into lower.
    P[6]  = P[1];   P[12] = P[2];  P[13] = P[8];
    P[18] = P[3];   P[19] = P[9];  P[20] = P[15];
    P[24] = P[4];   P[25] = P[10]; P[26] = P[16];
    P[27] = P[22];
    P[30] = P[5];   P[31] = P[11]; P[32] = P[17];
    P[33] = P[23];  P[34] = P[29];

    // Add Q = diag(σ_p² Δt², σ_p² Δt², σ_p² Δt², σ_v² Δt, σ_v² Δt, σ_v² Δt).
    const qp = this.sigmaPos * this.sigmaPos * dt * dt;
    const qv = this.sigmaVel * this.sigmaVel * dt;
    P[0]  += qp; P[7]  += qp; P[14] += qp;
    P[21] += qv; P[28] += qv; P[35] += qv;
  }

  /** Measurement update. residual is the trilateration RMS residual in meters
   *  (used to scale R — bigger residual → less trust → more smoothing). */
  update(z: KalmanVec3, residualMeters: number): void {
    if (!this.initialized) { this.init(z); return; }

    // Map residual to per-axis measurement σ. Floor + ceil prevent the
    // filter from freezing on a single great reading or chasing junk.
    const sigmaM = Math.min(
      Math.max(residualMeters, DEFAULT_R_FLOOR),
      DEFAULT_R_CEIL,
    );
    const rDiag = sigmaM * sigmaM;

    // Innovation y = z − Hx   (H selects positions: rows 0,1,2 of x)
    const y0 = z.x - this.x[0];
    const y1 = z.y - this.x[1];
    const y2 = z.z - this.x[2];

    // S = H P Hᵀ + R = upper-left 3x3 block of P + R*I
    const P = this.P;
    const s00 = P[0]  + rDiag, s01 = P[1],         s02 = P[2];
    const s11 = P[7]  + rDiag, s12 = P[8];
    const s22 = P[14] + rDiag;

    // Invert 3x3 symmetric S.
    const det =
      s00 * (s11 * s22 - s12 * s12)
      - s01 * (s01 * s22 - s12 * s02)
      + s02 * (s01 * s12 - s11 * s02);
    if (Math.abs(det) < 1e-12) return;
    const invDet = 1 / det;
    const i00 = (s11 * s22 - s12 * s12) * invDet;
    const i01 = -(s01 * s22 - s12 * s02) * invDet;
    const i02 = (s01 * s12 - s11 * s02) * invDet;
    const i11 = (s00 * s22 - s02 * s02) * invDet;
    const i12 = -(s00 * s12 - s01 * s02) * invDet;
    const i22 = (s00 * s11 - s01 * s01) * invDet;

    // Kalman gain K = P Hᵀ S⁻¹  → 6x3 matrix. K[i][j] = P[i][j] * S⁻¹ column.
    // P Hᵀ column j is just the j-th column of P's first 3 columns.
    const K = new Float64Array(18);   // 6 rows × 3 cols
    for (let row = 0; row < 6; row++) {
      const p0 = P[row * 6 + 0];
      const p1 = P[row * 6 + 1];
      const p2 = P[row * 6 + 2];
      K[row * 3 + 0] = p0 * i00 + p1 * i01 + p2 * i02;
      K[row * 3 + 1] = p0 * i01 + p1 * i11 + p2 * i12;
      K[row * 3 + 2] = p0 * i02 + p1 * i12 + p2 * i22;
    }

    // x ← x + K y
    for (let row = 0; row < 6; row++) {
      this.x[row] += K[row * 3 + 0] * y0
                  + K[row * 3 + 1] * y1
                  + K[row * 3 + 2] * y2;
    }

    // P ← (I − K H) P. Since H selects rows 0..2, (KH)[i][j] = K[i][j] for j<3,
    // 0 otherwise. So P_new[i][j] = P[i][j] − K[i][0]*P[0][j] − K[i][1]*P[1][j]
    // − K[i][2]*P[2][j]. We need to compute against the OLD P, so snapshot first.
    const oldP = new Float64Array(P);
    for (let i = 0; i < 6; i++) {
      const k0 = K[i * 3 + 0], k1 = K[i * 3 + 1], k2 = K[i * 3 + 2];
      for (let j = 0; j < 6; j++) {
        P[i * 6 + j] = oldP[i * 6 + j]
          - k0 * oldP[0 * 6 + j]
          - k1 * oldP[1 * 6 + j]
          - k2 * oldP[2 * 6 + j];
      }
    }
    // Re-symmetrize to compensate for round-off.
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        const avg = 0.5 * (P[i * 6 + j] + P[j * 6 + i]);
        P[i * 6 + j] = avg;
        P[j * 6 + i] = avg;
      }
    }
  }

  getState(): KalmanState {
    const P = this.P;
    const vx = Math.max(P[0],  0);
    const vy = Math.max(P[7],  0);
    const vz = Math.max(P[14], 0);
    return {
      position: { x: this.x[0], y: this.x[1], z: this.x[2] },
      velocity: { x: this.x[3], y: this.x[4], z: this.x[5] },
      positionVarianceTrace: vx + vy + vz,
      positionStdDev: { x: Math.sqrt(vx), y: Math.sqrt(vy), z: Math.sqrt(vz) },
    };
  }
}
