import axios from 'axios';

export type AlarmEvent = {
  id: number;
  ruleId: string;
  sensor: string;
  label: string;
  value: number;
  unit: string;
  kind: 'high' | 'low' | 'recover';
  threshold: number | null;
  message: string;
  ts: number;
  createdAt: string;
};

type AlarmEventsResponse = {
  events: AlarmEvent[];
  maxId: number;
};

// 独立报警服务(backend/alarm_service.py),开发环境经 vite 代理 /alarm-api → 127.0.0.1:8801。
const ALARM_API_BASE = import.meta.env.VITE_ALARM_API_BASE || '/alarm-api';

const alarmHttp = axios.create({
  baseURL: ALARM_API_BASE,
  timeout: 15 * 1000,
});

/** 拉取 id 大于 since 的新告警事件;返回事件列表与当前最大 id。 */
export function getAlarmEvents(since: number): Promise<AlarmEventsResponse> {
  return alarmHttp
    .get<AlarmEventsResponse>('/events', { params: { since } })
    .then((res) => res.data);
}
