(function () {
  const form = document.getElementById('form');
  const saveBtn = document.getElementById('saveBtn');
  const msgEl = document.getElementById('msg');

  function showMsg(text, type) {
    msgEl.textContent = text;
    msgEl.className = 'msg' + (type ? ' ' + type : '');
  }

  if (window.setupApi && window.setupApi.loadCurrentConfig) {
    window.setupApi.loadCurrentConfig().then(function (cfg) {
      if (cfg && cfg.email) document.getElementById('email').value = cfg.email;
      if (cfg && cfg.port) document.getElementById('port').value = String(cfg.port);
      if (cfg && cfg.headless !== undefined) document.getElementById('headless').checked = cfg.headless === true;
    }).catch(function () {});
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!window.setupApi || !window.setupApi.saveConfig) {
      showMsg('Setup API not available.', 'error');
      return;
    }
    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;
    var port = document.getElementById('port').value.trim() || '3500';
    var headless = document.getElementById('headless').checked;
    if (!email || !password) {
      showMsg('Please enter email and password.', 'error');
      return;
    }
    saveBtn.disabled = true;
    showMsg('Saving…', '');
    window.setupApi.saveConfig({
      email: email,
      password: password,
      port: port,
      headless: headless
    }).then(function () {
      showMsg('Saved. Launching app…', 'success');
    }).catch(function (err) {
      saveBtn.disabled = false;
      showMsg(err && err.message ? err.message : 'Save failed.', 'error');
    });
  });
})();
