// Claude driver: stream-json both ways. Permission requests arrive on stdout and are answered on stdin; the process can
// stay alive ("following") while background tasks run.
const { spawn } = require('node:child_process');
const { kill } = require('../../util/proc.cjs');
const { clip, tail } = require('../../util/text.cjs');
const A = require('../../attachments/rules.cjs');
const { lines, json } = require('./ndjson.cjs');

// What a Claude tool call touches, for the permission card.
function claudeDetail(name, input = {}) {
  if (input.file_path || input.notebook_path) return input.file_path || input.notebook_path;
  if (input.url) return input.url;
  if (input.path || input.pattern) return [input.path, input.pattern].filter(Boolean).join(' · ');
  if (input.description) return input.description;
  const keys = Object.keys(input);
  return keys.length ? clip(JSON.stringify(input), 600) : '';
}
const isShell = (name) => /^(bash|powershell|shell)$/i.test(String(name || ''));

function runClaude(spec, ctx) {
  const child = spawn(spec.exe, spec.args, {
    cwd: ctx.cwd,
    env: ctx.env,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '',
    closed = false;
  child.stdin.on('error', () => {});
  const write = (o) => {
    if (!closed && child.stdin.writable) child.stdin.write(JSON.stringify(o) + '\n');
  };
  // stdin stays open while Claude may still ask for permissions; it closes once the turn has its result
  // and no background subagent is still working (their completion starts another turn).
  const finish = () => {
    if (!closed) {
      closed = true;
      child.stdin.end();
    }
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (b) => (stderr = tail(stderr, b, 6000)));
  const control = async (e) => {
    const r = e.request || {};
    if (r.subtype !== 'can_use_tool')
      return write({
        type: 'control_response',
        response: { subtype: 'error', request_id: e.request_id, error: 'Não suportado pelo VeSTA: ' + r.subtype },
      });
    const input = r.input || {};
    const answer = await ctx.ask({
      provider: 'claude',
      tool: r.tool_name,
      title: r.description || r.display_name || r.tool_name,
      command: isShell(r.tool_name) ? input.command : '',
      detail: isShell(r.tool_name)
        ? r.blocked_path
          ? 'Caminho: ' + r.blocked_path
          : ''
        : claudeDetail(r.tool_name, input),
      subagent: ctx.parse.ownerOf(r.tool_use_id) || (r.agent_id ? 'subagente' : ''),
    });
    write({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: e.request_id,
        response: answer.allow
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: answer.message || 'Negado pelo usuário.' },
      },
    });
  };
  // After the final result Claude may stay alive only to wait for background shell commands it started (a dev
  // server, a watcher) that never end. The turn is over: give it a moment, then end claude.exe alone, never its
  // process tree, so whatever it left running keeps running.
  let settled = false,
    linger = null;
  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimeout(nudge);
    finish();
    linger = setTimeout(() => {
      if (child.exitCode === null)
        try {
          child.kill();
        } catch {}
    }, ctx.lingerMs ?? 5000);
  };
  // Following mode: the turn ended but commands/monitors it started in the background are still running. The process
  // stays alive with stdin open; the CLI itself starts the next turn when a task_notification arrives (verified:
  // system/init + a full assistant turn, no user message needed). 'turn' = a turn is in progress, 'idle' = waiting.
  let phase = 'turn',
    nudge = null,
    lastTasks = '[]';
  const begin = (opts) => {
    clearTimeout(nudge);
    phase = 'turn';
    ctx.parse.nextTurn?.();
    ctx.onAutoTurn?.(opts);
  };
  // The CLI normally starts the turn on its own; if it does not within a few seconds, VeSTA asks for it.
  const armNudge = (finished) => {
    clearTimeout(nudge);
    const ms = ctx.follow?.nudgeMs;
    if (!ms) return;
    nudge = setTimeout(() => {
      if (phase !== 'idle' || settled || closed) return;
      begin({ nudged: true });
      write({
        type: 'user',
        message: { role: 'user', content: ctx.follow.nudgeText ? ctx.follow.nudgeText(finished) : '' },
      });
    }, ms);
    nudge.unref?.();
  };
  lines(child.stdout, (l) => {
    const e = json(l);
    if (!e) {
      stderr = tail(stderr, '\n' + l, 6000);
      return;
    }
    if (e.type === 'control_request') {
      control(e).catch(() => {});
      return;
    }
    if (e.type === 'control_response' || e.type === 'control_cancel_request') return;
    const sys = e.type === 'system' ? e.subtype : '';
    // The CLI started a turn by itself (after a background task finished).
    if (phase === 'idle' && !settled && (sys === 'init' || e.type === 'stream_event' || e.type === 'assistant'))
      begin({ nudged: false });
    ctx.parse.accept(e);
    if (sys === 'background_tasks_changed') {
      const tasks = ctx.parse.followTasks?.() || [],
        key = JSON.stringify(tasks);
      if (key !== lastTasks) {
        lastTasks = key;
        ctx.onTasks?.(tasks);
      }
    }
    if (phase === 'idle' && sys === 'task_notification')
      armNudge([{ taskId: e.task_id, description: String(e.summary || '').slice(0, 160) }]);
    // On resume, a background task that died with the previous process is delivered first as its own empty
    // turn (num_turns 0, no result text); the answer to this prompt comes after it, so that one must not settle.
    if (e.type === 'result' && !(e.num_turns === 0 && !e.result) && !ctx.parse.backgroundRunning()) {
      const tasks = ctx.parse.followTasks?.() || [];
      if (!settled && tasks.length && !e.is_error && ctx.follow?.allow?.(tasks)) {
        phase = 'idle';
        ctx.onFollow?.(tasks);
      } else settle();
    }
  });
  const contentOf = (prompt, attachments) => {
    try {
      return A.claudeContent(prompt, attachments);
    } catch {
      return prompt;
    }
  };
  write({ type: 'user', message: { role: 'user', content: contentOf(ctx.prompt, ctx.attachments) } });
  const done = new Promise((resolve) => {
    child.on('error', (err) => resolve({ code: -1, stderr: err.message }));
    child.on('close', (code) => {
      clearTimeout(linger);
      resolve({ code: settled ? 0 : code, stderr });
    });
  });
  return {
    done,
    stop() {
      clearTimeout(nudge);
      finish();
      kill(child);
    },
    // True while claude.exe waits (idle) for background tasks and can take another message.
    following: () => phase === 'idle' && !settled && !closed && child.exitCode === null,
    // A new user message for the process that is already following: same session, same task links.
    sendUser(prompt, attachments) {
      if (phase !== 'idle' || settled || closed || child.exitCode !== null) return false;
      clearTimeout(nudge);
      phase = 'turn';
      ctx.parse.nextTurn?.();
      write({ type: 'user', message: { role: 'user', content: contentOf(prompt, attachments) } });
      return true;
    },
    // Stops following: closes stdin and ends claude.exe alone (never its process tree), so the user's processes live on.
    stopFollowing({ immediate = false } = {}) {
      if (settled) return false;
      settle();
      if (immediate && child.exitCode === null)
        try {
          child.kill();
        } catch {}
      return true;
    },
    // Asks Claude to end one background task (command, monitor or subagent). Only while the process is alive.
    stopTask(taskId) {
      if (closed || settled || !taskId) return false;
      write({
        type: 'control_request',
        request_id: 'vesta-stop-' + taskId,
        request: { subtype: 'stop_task', task_id: taskId },
      });
      return true;
    },
  };
}
module.exports = { runClaude, claudeDetail, isShell };
