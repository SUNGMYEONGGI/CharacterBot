import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Routine, Schedule } from '../shared/types';

// Limits borrowed from OpenBot so one sentence can't schedule runaway spend.
const MIN_INTERVAL_MINUTES = 15;
const MAX_ENABLED = 20;
const MAX_FAILURES = 10;

// Event triggers (see triggers.cjs) or a time schedule.
export interface ScheduleInput {
  every_minutes?: number;
  daily_time?: string;
  webhook?: boolean;
  watch_path?: string;
  github_repo?: string;
}

function validateSchedule({ every_minutes, daily_time, webhook, watch_path, github_repo }: ScheduleInput): Schedule {
  if (webhook) return { type: 'webhook', key: crypto.randomBytes(12).toString('hex') };
  if (watch_path) {
    const full = path.resolve(String(watch_path).replace(/^~(?=\/|$)/, os.homedir()));
    if (!fs.existsSync(full)) throw new Error(`폴더가 없습니다: ${full}`);
    return { type: 'file', path: full };
  }
  if (github_repo) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(github_repo)) throw new Error('github_repo는 owner/name 형식이어야 합니다');
    return { type: 'github', repo: github_repo };
  }
  if (daily_time) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(daily_time)) throw new Error('daily_time은 HH:MM 형식이어야 합니다');
    return { type: 'daily', time: daily_time };
  }
  const minutes = Number(every_minutes);
  if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL_MINUTES) {
    throw new Error(`반복 간격은 최소 ${MIN_INTERVAL_MINUTES}분입니다`);
  }
  return { type: 'interval', minutes: Math.round(minutes) };
}

// Next fire time in ms, measured from the last run (or creation).
function nextRun(routine: Routine): number {
  const from = routine.lastRun || routine.createdAt;
  const { schedule } = routine;
  if (schedule.type === 'interval') return from + schedule.minutes * 60_000;
  if (schedule.type !== 'daily') return Infinity;
  const [h, m] = schedule.time.split(':').map(Number);
  const next = new Date(from);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= from) next.setDate(next.getDate() + 1);
  return next.getTime();
}

const EVENT_TYPES: Schedule['type'][] = ['webhook', 'file', 'github'];
const isDue = (routine: Routine, now: number): boolean => routine.enabled && !EVENT_TYPES.includes(routine.schedule.type) && now >= nextRun(routine);

function describe(schedule: Schedule): string {
  switch (schedule.type) {
    case 'daily': return `매일 ${schedule.time}`;
    case 'interval': return `${schedule.minutes}분마다`;
    case 'webhook': return '웹훅이 올 때';
    case 'file': return `${schedule.path} 폴더가 바뀔 때`;
    case 'github': return `${schedule.repo} PR이 열리거나 업데이트될 때`;
  }
}

export { validateSchedule, nextRun, isDue, describe, MAX_ENABLED, MAX_FAILURES };
