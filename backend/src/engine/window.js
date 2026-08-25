export function inCallingDays(schedule = {}, at = new Date()) {
  const days = String(schedule.days || "Every day");
  if (/every/i.test(days)) return true;
  const weekday = at.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: schedule.timezone || "Asia/Kolkata",
  });
  return days.toLowerCase().includes(weekday.slice(0, 3).toLowerCase());
}

export function inCallingWindow(schedule = {}, at = new Date()) {
  if (!inCallingDays(schedule, at)) return false;
  const tz = schedule.timezone || "Asia/Kolkata";
  const start = String(schedule.start || "00:00:00");
  const end = String(schedule.end || "23:59:00");
  const clock = at.toLocaleTimeString("en-GB", { hour12: false, timeZone: tz });
  const hhmmss = clock.length === 8 ? clock : `${clock}:00`;
  if (start <= end) return hhmmss >= start && hhmmss <= end;
  return hhmmss >= start || hhmmss <= end;
}

export function msUntilWindow(schedule = {}, at = new Date()) {
  if (inCallingWindow(schedule, at)) return 0;
  return 5 * 60 * 1000;
}
