/**
 * Geo-fencing for attendance. Great-circle (haversine) distance in metres;
 * a check-in is valid only inside the company fence. Pure — mirrors the DB
 * check and powers the client-side "you're too far" hint.
 */
export interface LatLng {
  lat: number
  lng: number
}

const R = 6_371_000 // Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(s)))
}

export function withinFence(point: LatLng, center: LatLng, radiusMeters: number): boolean {
  return haversineMeters(point, center) <= radiusMeters
}
