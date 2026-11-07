/** A track's length as the library lists it: 6분 02초. */
export function trackLength(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}분 ${String(whole % 60).padStart(2, "0")}초`;
}

/**
 * 을 or 를 after a word, by whether its last syllable ends in a consonant.
 * A word that does not end in Hangul gets both, the way forms write it.
 */
export function objectParticle(word: string): string {
  const syllable = word.trim().charCodeAt(word.trim().length - 1) - 0xac00;
  if (!(syllable >= 0 && syllable <= 11171)) return "을(를)";
  return syllable % 28 === 0 ? "를" : "을";
}
