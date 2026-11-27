// The system scheduler that wakes an installed agent with VeSTA closed. Only Node built-ins: this file is copied into
// the agents folder next to vesta-agent.cjs (see runner/files.cjs).
//   windows  one task per agent in the Task Scheduler folder \VeSTA\ (vesta-agent-<slug>), registered from XML so the
//            arguments, "run when available" (catch-up) and "keep going on battery" are set exactly
//   systemd  a user service + timer per agent (vesta-agent-<slug>.timer in ~/.config/systemd/user): a VPS or any Linux
//            with systemd; Persistent=true is the catch-up, and "loginctl enable-linger" keeps it going logged out
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

// ---- systemd -------------------------------------------------------------------------------------------------------
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// The [Timer] lines of a schedule, or null when it only runs on request. Calendar times are the machine's own zone.
function timerLines(schedule, catchUp = true) {
  const s = schedule || {};
  if (s.kind === 'interval') {
    const h = Math.max(1, Number(s.hours) || 4);
    return ['OnActiveSec=' + h + 'h', 'OnUnitActiveSec=' + h + 'h'];
  }
  if (!['daily', 'weekdays', 'weekly'].includes(s.kind)) return null;
  const [h, m] = String(s.time || '08:30')
    .split(':')
    .map(Number);
  const at = pad(h || 0) + ':' + pad(m || 0) + ':00';
  const days =
    s.kind === 'daily'
      ? ''
      : s.kind === 'weekdays'
        ? 'Mon..Fri '
        : (s.days || [])
            .filter((d) => d >= 0 && d <= 6)
            .map((d) => DOW[d])
            .join(',') + ' ';
  if (s.kind === 'weekly' && !days.trim()) return null;
  return ['OnCalendar=' + days + '*-*-* ' + at, 'Persistent=' + (catchUp ? 'true' : 'false')];
}
// systemd reads ExecStart itself: each argument in double quotes, and % is its own escape.
const unitArg = (a) => '"' + String(a).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%') + '"';
const oneLine = (s) =>
  String(s)
    .replace(/[\r\n]+/g, ' ')
    .replace(/%/g, '%%');
// { service, timer } texts, or null for a schedule that only runs on request. One run at a time is systemd's own
// rule for a oneshot service; it stops after two hours.
function unitFiles({ name, schedule, catchUp = true, command, args = [] }) {
  const timer = timerLines(schedule, catchUp);
  if (!timer) return null;
  const description = 'Description=' + oneLine('Agent do VeSTA: ' + name);
  return {
    service: [
      '[Unit]',
      description,
      '',
      '[Service]',
      'Type=oneshot',
      'ExecStart=' + [command, ...args].map(unitArg).join(' '),
      'TimeoutStartSec=2h',
      '',
    ].join('\n'),
    timer: ['[Unit]', description, '', '[Timer]', ...timer, '', '[Install]', 'WantedBy=timers.target', ''].join('\n'),
  };
}
const unitDir = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'systemd', 'user');
function systemdScheduler({ run, dir = unitDir() }) {
  const unit = (slug) => 'vesta-agent-' + slug;
  const files = (slug) => [path.join(dir, unit(slug) + '.service'), path.join(dir, unit(slug) + '.timer')];
  const ctl = (...args) => run('systemctl', ['--user', ...args]);
  return {
    kind: 'systemd',
    taskName: (slug) => unit(slug) + '.timer',
    describe: (slug) => 'systemd: ' + unit(slug) + '.timer',
    async register(slug, { name, schedule, catchUp, command, args }) {
      const u = unitFiles({ name, schedule, catchUp, command, args });
      if (!u) {
        await this.unregister(slug);
        return false;
      }
      fs.mkdirSync(dir, { recursive: true });
      const [service, timer] = files(slug);
      fs.writeFileSync(service, u.service);
      fs.writeFileSync(timer, u.timer);
      await ctl('daemon-reload');
      // A changed timer starts over with its new times.
      await ctl('enable', unit(slug) + '.timer');
      await ctl('restart', unit(slug) + '.timer');
      return true;
    },
    async unregister(slug) {
      try {
        await ctl('disable', '--now', unit(slug) + '.timer');
      } catch {}
      const had = files(slug).some((f) => fs.existsSync(f));
      for (const f of files(slug)) fs.rmSync(f, { force: true });
      if (had)
        try {
          await ctl('daemon-reload');
        } catch {}
    },
    exists: async (slug) => fs.existsSync(files(slug)[1]),
  };
}

const exec = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { windowsHide: true, timeout: 30000 }, (e, out, err) =>
      e ? reject(new Error(String(err || e.message).trim())) : resolve(String(out))
    )
  );

// kind: 'windows' | 'systemd' | 'none'; folder: the Task Scheduler folder (tests use their own); dir: systemd's units.
function createScheduler({
  kind = process.platform === 'win32' ? 'windows' : 'none',
  folder = 'VeSTA',
  run = exec,
  dir,
} = {}) {
  if (kind === 'systemd') return systemdScheduler({ run, dir });
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

module.exports = { createScheduler, taskXml, triggersXml, quoteArg, unitFiles, timerLines };
