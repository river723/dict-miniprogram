/** 日期 / id 工具 —— 移植自 memo-grad utils（去 RN 依赖）。 */

export const formatDate = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

export const subDays = (date, days) => addDays(date, -days);

export const diffDays = (a, b) =>
  Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

/** 简易 UUID（小程序端无 crypto.randomUUID 保证）。 */
export const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

export const weekdayLabel = (d) =>
  ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
