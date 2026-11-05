// Activation / startup screen. All license logic lives in the Rust shell;
// this page only collects the sign-in and shows progress.
const { invoke } = window.__TAURI__.core;
const $ = (id) => document.getElementById(id);

function show(state) {
  for (const s of document.querySelectorAll('.state')) s.hidden = s.id !== state;
}

function loading(text, hint = '') {
  $('loading-text').textContent = text;
  $('loading-hint').textContent = hint;
  show('loading');
}

async function startApp(firstRun) {
  loading(
    firstRun ? 'Préparation de vos données…' : 'Ouverture de Stockily…',
    firstRun ? 'Première ouverture : création de la base locale et téléchargement de vos données. Cela peut prendre une minute.' : '',
  );
  try {
    await invoke('start'); // the window navigates to the app when ready
  } catch (err) {
    $('failed-message').textContent = String(err);
    show('failed');
  }
}

async function boot() {
  loading('Vérification de la licence…');
  try {
    const s = await invoke('boot');
    if (s.state === 'start') return startApp(false);
    $('label').value = s.deviceLabel;
    const msg = $('activate-message');
    msg.hidden = !s.message;
    msg.textContent = s.message ?? '';
    show('activate');
    $('email').focus();
  } catch (err) {
    $('failed-message').textContent = String(err);
    show('failed');
  }
}

$('activate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('activate-btn');
  const error = $('activate-error');
  error.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Activation…';
  try {
    await invoke('activate', { email: $('email').value.trim(), password: $('password').value, label: $('label').value });
    await startApp(true);
  } catch (err) {
    error.textContent = String(err);
    error.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Activer et ouvrir Stockily';
  }
});

$('retry-btn').addEventListener('click', boot);
boot();
