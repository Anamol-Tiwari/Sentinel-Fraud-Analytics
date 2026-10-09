// City coordinates used for impossible-travel and geo-mismatch checks.
export const CITIES = {
  "Mumbai, IN": [19.076, 72.8777], "Delhi, IN": [28.6139, 77.209], "Bengaluru, IN": [12.9716, 77.5946],
  "Pune, IN": [18.5204, 73.8567], "Hyderabad, IN": [17.385, 78.4867], "Chennai, IN": [13.0827, 80.2707],
  "Kolkata, IN": [22.5726, 88.3639], "Jaipur, IN": [26.9124, 75.7873], "Ahmedabad, IN": [23.0225, 72.5714],
  "Singapore, SG": [1.3521, 103.8198], "Dubai, AE": [25.2048, 55.2708], "London, GB": [51.5072, -0.1276],
  "New York, US": [40.7128, -74.006], "Lagos, NG": [6.5244, 3.3792], "Moscow, RU": [55.7558, 37.6173],
};
export const INDIAN_CITIES = Object.keys(CITIES).filter((c) => c.endsWith(", IN"));
export const FOREIGN_CITIES = Object.keys(CITIES).filter((c) => !c.endsWith(", IN"));
export const country = (loc) => String(loc || "").split(",").pop().trim();

export function distanceKm(a, b) {
  const A = CITIES[a], B = CITIES[b];
  if (!A || !B) return 0;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(B[0] - A[0]), dLon = rad(B[1] - A[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(A[0])) * Math.cos(rad(B[0])) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
