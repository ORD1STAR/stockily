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

// Looks for a newer version first. A prefetched one installs at once (the app
// is replaced and relaunched); otherwise it is downloaded here, with progress.
// Any problem (offline, server down, bad signature) is ignored: opening the
// shop's software always wins over updating it.
async function updateIfAny() {
  try {
    loading('Recherche de mises à jour…');
    const info = await invoke('update_check');
    if (!info.available) return;
    loading(`Mise à jour de Stockily vers ${info.version}…`, 'Téléchargement en cours. Stockily se rouvrira tout seul.');
    const mb = (n) => (n / 1e6).toFixed(0);
    await window.__TAURI__.event.listen('update-progress', (e) => {
      const { downloaded, total } = e.payload;
      $('loading-hint').textContent = total
        ? `Téléchargement : ${mb(downloaded)} sur ${mb(total)} Mo (${Math.round((downloaded / total) * 100)} %). Stockily se rouvrira tout seul.`
        : `Téléchargement : ${mb(downloaded)} Mo. Stockily se rouvrira tout seul.`;
    });
    await invoke('update_install'); // on success the app is replaced and never returns here
  } catch (_) {
    /* carry on with the installed version */
  }
}

async function boot() {
  await updateIfAny();
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
    const out = await invoke('activate', { email: $('email').value.trim(), password: $('password').value, label: $('label').value });
    if (out.otpRequired) return showOtp(out.email);
    await startApp(true);
  } catch (err) {
    error.textContent = String(err);
    error.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Activer et ouvrir Stockily';
  }
});

// Second step: the server emailed a code (two-factor, or a new address to confirm).
let resendTimer = null;
function showOtp(maskedEmail) {
  $('otp-email').textContent = maskedEmail ?? 'votre adresse e-mail';
  $('otp-code').value = '';
  $('otp-error').hidden = true;
  show('otp');
  $('otp-code').focus();
  cooldown(30);
}
function cooldown(seconds) {
  clearInterval(resendTimer);
  const link = $('otp-resend');
  let left = seconds;
  const tick = () => {
    link.textContent = left > 0 ? `Renvoyer le code (${left} s)` : 'Renvoyer le code';
    link.dataset.disabled = left > 0 ? '1' : '';
    if (left-- <= 0) clearInterval(resendTimer);
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}
async function submitOtp(code) {
  const btn = $('otp-btn');
  const error = $('otp-error');
  error.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Vérification…';
  try {
    await invoke('activate_verify', { code });
    await startApp(true);
  } catch (err) {
    error.textContent = String(err);
    error.hidden = false;
    $('otp-code').value = '';
    $('otp-code').focus();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Vérifier et ouvrir Stockily';
  }
}
$('otp-form').addEventListener('submit', (e) => {
  e.preventDefault();
  submitOtp($('otp-code').value.trim());
});
$('otp-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  if (e.target.value.length === 6) submitOtp(e.target.value);
});
$('otp-resend').addEventListener('click', async (e) => {
  e.preventDefault();
  if (e.target.dataset.disabled) return;
  try {
    cooldown(await invoke('activate_resend'));
    $('otp-error').hidden = true;
  } catch (err) {
    $('otp-error').textContent = String(err);
    $('otp-error').hidden = false;
  }
});
$('otp-back').addEventListener('click', async (e) => {
  e.preventDefault();
  clearInterval(resendTimer);
  await invoke('activate_cancel');
  show('activate');
  $('password').focus();
});

$('retry-btn').addEventListener('click', boot);
boot();
