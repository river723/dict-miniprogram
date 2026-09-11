/**
 * mg-difficulty —— DifficultyBadge / DifficultyDots 的小程序版（5 档难度圆点）。
 *
 *   <mg-difficulty level="3" />
 *   <mg-difficulty level="3" show-number size="sm" />
 */
const DIFFICULTY = ['#3F7A5C', '#7AA85F', '#D4A93A', '#C2603A', '#B5462E'];
const OUTLINE = '#E0DDD4';

Component({
  options: { addGlobalClass: true },

  properties: {
    level: { type: null, value: 1 },
    showNumber: { type: Boolean, value: false },
    /** sm | md（对应 App 的 5/7 px 圆点） */
    size: { type: String, value: 'md' },
  },

  data: {
    dots: [],
    color: DIFFICULTY[0],
    dotSize: 14,
    gap: 6,
    fontSize: 26,
  },

  observers: {
    'level, size, showNumber'(level, size) {
      const safe = Math.max(1, Math.min(5, Number(level) || 1));
      const color = DIFFICULTY[safe - 1];
      const dots = [];
      for (let i = 0; i < 5; i += 1) {
        dots.push(i < safe ? color : OUTLINE);
      }
      this.setData({
        dots,
        color,
        dotSize: size === 'sm' ? 10 : 14,
        gap: size === 'sm' ? 4 : 6,
        fontSize: size === 'sm' ? 22 : 26,
        safeLevel: safe,
      });
    },
  },
});
