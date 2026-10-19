import './splash.css';

// The opening window: it only draws the state the main process sends (see electron/boot.cjs). No framework, no timers.
const $ = (id) => document.getElementById(id);
const api = window.splash;

function render(state) {
  $('label').textContent = state.label;
  $('percent').textContent = state.percent + '%';
  $('bar').setAttribute('aria-valuenow', String(state.percent));
  $('fill').style.setProperty('--progress', state.percent + '%');
  for (const step of state.steps)
    $('steps').querySelector('[data-step="' + step.id + '"]').dataset.done = String(step.done);
  if (state.version) $('version').textContent = 'V' + state.version;
  document.body.dataset.state = state.error ? 'error' : state.complete ? 'ready' : 'loading';
  $('fail').hidden = !state.error;
  if (state.error) {
    $('message').textContent = state.error.message;
    $('proceed').hidden = !state.error.canContinue;
  }
}

if (api) {
  api.onState(render);
  api.onLeave(() => document.body.classList.add('leaving'));
  $('quit').addEventListener('click', () => api.quit());
  $('proceed').addEventListener('click', () => api.proceed());
}
