// 相对时间：对话行在 branch_count = 0 时显示（规格 1-项目行-对话行：昨天 / 3 天前）。
// 按本地日历日计算：当天显示 HH:MM，前一天“昨天”，2–6 天“N 天前”，更早显示“M 月 D 日”。

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function relativeDay(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(t)) / 86_400_000);
  if (days <= 0) {
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  return `${t.getMonth() + 1} 月 ${t.getDate()} 日`;
}
