import confetti from 'canvas-confetti';

const RPG_COLORS = ['#F7C948', '#E45D50', '#4F8F69', '#3B82F6', '#FFF9EB'];

/**
 * 觸發輕量慶祝彩帶特效（自動尊重系統減少動態偏好設定）
 */
export function fireConfetti(kind: 'rsvp' | 'approve' | 'settled' = 'rsvp'): void {
  try {
    if (kind === 'settled') {
      confetti({
        particleCount: 70,
        angle: 60,
        spread: 60,
        origin: { x: 0.1, y: 0.65 },
        colors: RPG_COLORS,
        disableForReducedMotion: true,
      });
      confetti({
        particleCount: 70,
        angle: 120,
        spread: 60,
        origin: { x: 0.9, y: 0.65 },
        colors: RPG_COLORS,
        disableForReducedMotion: true,
      });
      return;
    }

    confetti({
      particleCount: kind === 'approve' ? 45 : 55,
      spread: 65,
      origin: { y: 0.62 },
      colors: RPG_COLORS,
      disableForReducedMotion: true,
    });
  } catch {
    // Ignore confetti failure in headless / unsupported environments
  }
}
