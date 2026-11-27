// The system scheduler that wakes an installed agent with VeSTA closed. Only Node built-ins: this file is copied into
// the agents folder next to vesta-agent.cjs (see runner/files.cjs).
//   windows  one task per agent in the Task Scheduler folder \VeSTA\ (vesta-agent-<slug>), registered from XML so the
//            arguments, "run when available" (catch-up) and "keep going on battery" are set exactly
//   none     nothing is registered: the agent only runs on request (tests, and the manual schedule)
// A schedule is the agent's own ({ kind, time, days, hours }, shared/agents.cjs).
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { execFile } = require('node:child_process');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const xmlEscape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
// Local time without a zone: the Task Scheduler reads it as the computer's time.
const local = (d) =>
  d.getFullYear() +
  '-' +
  pad(d.getMonth() + 1) +
  '-' +
  pad(d.getDate()) +
  'T' +
  pad(d.getHours()) +
  ':' +
  pad(d.getMinutes()) +
  ':00';
// Windows wants a command line: each argument quoted when it has a space or a quote.
const quoteArg = (a) => (/[\s"]/.test(a) || a === '' ? '"' + String(a).replace(/"/g, '\\"') + '"' : String(a));

// The triggers of a schedule, or null when it only runs on request.
function triggersXml(schedule, now = new Date()) {
  const s = schedule || {};
  if (s.kind === 'interval') {
    const start = new Date(now.getTime() + (Number(s.hours) || 4) * 3600000);
    return (
      '<TimeTrigger><StartBoundary>' +
      local(start) +
      '</StartBoundary><Repetition><Interval>PT' +
      (Number(s.hours) || 4) +
      'H</Interval></Repetition><Enabled>true</Enabled></TimeTrigger>'
    );
  }
  if (!['daily', 'weekdays', 'weekly'].includes(s.kind)) return null;
  const [h, m] = String(s.time || '08:30')
    .split(':')
    .map(Number);
  const start = new Date(now);
  start.setHours(h, m, 0, 0);
  const boundary = '<StartBoundary>' + local(start) + '</StartBoundary>';
  if (s.kind === 'daily')
    return (
      '<CalendarTrigger>' +
      boundary +
      '<Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>'
    );
  const days = s.kind === 'weekdays' ? [1, 2, 3, 4, 5] : (s.days || []).filter((d) => d >= 0 && d <= 6);
  if (!days.length) return null;
  return (
    '<CalendarTrigger>' +
    boundary +
    '<Enabled>true</Enabled><ScheduleByWeek><DaysOfWeek>' +
    days.map((d) => '<' + DAYS[d] + ' />').join('') +
    '</DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek></CalendarTrigger>'
  );
}

// The whole task: runs as the person (only while they are logged in, no password kept), one run at a time, at most
// two hours, also on battery; catchUp = a time missed while the computer was off runs as soon as it can.
function taskXml({ name, schedule, catchUp = true, command, args = [], now = new Date() }) {
  const triggers = triggersXml(schedule, now);
  if (!triggers) return null;
  return (
    '<?xml version="1.0" encoding="UTF-16"?>\n' +
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">' +
    '<RegistrationInfo><Description>' +
    xmlEscape('Agent do VeSTA: ' + name) +
    '</Description></RegistrationInfo>' +
    '<Triggers>' +
    triggers +
    '</Triggers>' +
    '<Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>' +
    '<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>' +
    '<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>' +
    '<StartWhenAvailable>' +
    (catchUp ? 'true' : 'false') +
    '</StartWhenAvailable><ExecutionTimeLimit>PT2H</ExecutionTimeLimit><Enabled>true</Enabled></Settings>' +
    '<Actions Context="Author"><Exec><Command>' +
    xmlEscape(command) +
    '</Command><Arguments>' +
    xmlEscape(args.map(quoteArg).join(' ')) +
    '</Arguments></Exec></Actions></Task>'
  );
}

const exec = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { windowsHide: true, timeout: 30000 }, (e, out, err) =>
      e ? reject(new Error(String(err || e.message).trim())) : resolve(String(out))
    )
  );

// kind: 'windows' | 'none'; folder: the Task Scheduler folder (tests use their own).
function createScheduler({
  kind = process.platform === 'win32' ? 'windows' : 'none',
  folder = 'VeSTA',
  run = exec,
} = {}) {
  const taskName = (slug) => '\\' + folder + '\\vesta-agent-' + slug;
  if (kind !== 'windows')
    return {
      kind: 'none',
      taskName,
      describe: () => 'só quando você pedir',
      register: async () => false,
      unregister: async () => {},
      exists: async () => false,
    };
  return {
    kind,
    taskName,
    describe: (slug) => 'Agendador de Tarefas: ' + taskName(slug),
    // Replaces the task. false when the schedule only runs on request (the old task, if any, goes).
    async register(slug, { name, schedule, catchUp, command, args }) {
      const xml = taskXml({ name, schedule, catchUp, command, args });
      if (!xml) {
        await this.unregister(slug);
        return false;
      }
      const file = path.join(os.tmpdir(), 'vesta-agent-task-' + process.pid + '-' + slug + '.xml');
      fs.writeFileSync(file, '﻿' + xml, 'utf16le');
      try {
        await run('schtasks', ['/create', '/tn', taskName(slug), '/xml', file, '/f']);
      } finally {
        fs.rmSync(file, { force: true });
      }
      return true;
    },
    async unregister(slug) {
      try {
        await run('schtasks', ['/delete', '/tn', taskName(slug), '/f']);
      } catch {}
    },
    async exists(slug) {
      try {
        await run('schtasks', ['/query', '/tn', taskName(slug)]);
        return true;
      } catch {
        return false;
      }
    },
  };
}

module.exports = { createScheduler, taskXml, triggersXml, quoteArg };
