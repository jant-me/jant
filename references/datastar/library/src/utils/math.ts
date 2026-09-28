export const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value))
}

export const lerp = (
  min: number,
  max: number,
  t: number,
  clamped = true,
): number => {
  return min + (max - min) * (clamped ? clamp(t, 0, 1) : t)
}

export const inverseLerp = (
  min: number,
  max: number,
  value: number,
  clamped = true,
): number => {
  const v = (value - min) / (max - min)
  return clamped ? clamp(v, 0, 1) : v
}

export const fit = (
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
  clamped = true,
  rounded = false,
): number => {
  const t = inverseLerp(inMin, inMax, value, clamped)
  const fitted = lerp(outMin, outMax, t, clamped)
  return rounded ? Math.round(fitted) : fitted
}
