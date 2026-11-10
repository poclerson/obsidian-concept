export interface Mat4 {
  /** Row-major 4x4 matrix, as stored by Concepts / NSKeyedArchiver. */
  readonly m: readonly number[];
}

export const IDENTITY_MAT4: Mat4 = {
  m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
};

export function parseMat4(data: Uint8Array | null | undefined): Mat4 | null {
  if (!data || data.byteLength < 64) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const m = new Array<number>(16);
  for (let i = 0; i < 16; i += 1) {
    const value = view.getFloat32(i * 4, true);
    if (!Number.isFinite(value)) {
      return null;
    }
    m[i] = value;
  }
  return { m };
}

export function isIdentityMat4(mat: Mat4 | null): boolean {
  if (!mat) {
    return true;
  }
  const m = mat.m;
  return (
    Math.abs(m[0] - 1) < 1e-6 &&
    Math.abs(m[1]) < 1e-6 &&
    Math.abs(m[4]) < 1e-6 &&
    Math.abs(m[5] - 1) < 1e-6 &&
    Math.abs(m[12]) < 1e-6 &&
    Math.abs(m[13]) < 1e-6
  );
}

export function applyMat4(mat: Mat4 | null, x: number, y: number): { x: number; y: number } {
  if (!mat) {
    return { x, y };
  }
  const m = mat.m;
  return {
    x: m[0] * x + m[4] * y + m[12],
    y: m[1] * x + m[5] * y + m[13],
  };
}

/**
 * Approximate uniform scale of the X/Y basis vectors. Concepts stores stroke
 * width separately from the points, so width has to be scaled with the
 * transform to stay visually correct.
 */
export function mat4Scale(mat: Mat4 | null): number {
  if (!mat) {
    return 1;
  }
  const m = mat.m;
  const scaleX = Math.hypot(m[0], m[1]);
  const scaleY = Math.hypot(m[4], m[5]);
  const scale = Math.sqrt(scaleX * scaleY);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function mat4Rotation(mat: Mat4 | null): number {
  if (!mat) {
    return 0;
  }
  const m = mat.m;
  return Math.atan2(m[1], m[0]);
}
