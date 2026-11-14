export const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour12: false });

export const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
};
