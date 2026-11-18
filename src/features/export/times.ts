/**
 * Lengths of time as the export window and the render queue say them. Each is rounded before it is split into
 * its parts, so the seconds of a minute and the minutes of an hour never read 60.
 */

/** How long an export has left, or took: “12s”, “1m 30s”, “1h 5m”. */
export function fmtEta(s: number) {
  const whole = Math.max(1, Math.round(s))
  if (whole < 60) return `${whole}s`
  if (whole < 3600) return `${Math.floor(whole / 60)}m ${whole % 60}s`
  const minutes = Math.round(whole / 60)
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** How long a render in the queue took: “12s”, “1m 30s”. */
export function fmtTime(s: number) {
  const whole = Math.max(1, Math.round(s))
  return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}m ${whole % 60}s`
}
