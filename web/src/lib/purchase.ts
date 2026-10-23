/** Open a supplier search so availability and variants are shown by the seller. */
export function purchaseUrl(name: string): string {
  return `https://www.adafruit.com/search?q=${encodeURIComponent(name)}`;
}
