export function generateToken() {
  return crypto.randomUUID().replace(/-/g, "");
}
