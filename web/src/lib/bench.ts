export const BAND_COLORS = [
  { name: "Black", hex: "#252525" }, { name: "Brown", hex: "#885232" },
  { name: "Red", hex: "#e7564c" }, { name: "Orange", hex: "#ec923e" },
  { name: "Yellow", hex: "#f3cb4c" }, { name: "Green", hex: "#53a877" },
  { name: "Blue", hex: "#4b8cd7" }, { name: "Violet", hex: "#a079cf" },
  { name: "Grey", hex: "#9297a0" }, { name: "White", hex: "#f1eee6" },
];

export function formatOhms(value: number): string {
  if (value >= 1e6) return `${Number((value / 1e6).toPrecision(3))} MΩ`;
  if (value >= 1e3) return `${Number((value / 1e3).toPrecision(3))} kΩ`;
  return `${Number(value.toPrecision(3))} Ω`;
}

const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];
export function ledResistor(supply: number, forward: number, milliamps: number) {
  if (![supply, forward, milliamps].every(Number.isFinite) || supply <= forward || forward <= 0 || milliamps <= 0 || supply > 24 || milliamps > 30) return null;
  const minimum = (supply - forward) / (milliamps / 1000);
  const decade = 10 ** Math.floor(Math.log10(minimum));
  const resistance = (E12.find((value) => value * decade / 10 >= minimum - 1e-9) ?? 100) * decade / 10;
  const actualMa = (supply - forward) / resistance * 1000;
  return { minimum, resistance, actualMa, watts: (supply - forward) ** 2 / resistance };
}
