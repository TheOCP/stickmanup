// Runs before everything else, in JavaScript so old that any WebView can read it.
//
// A phone can have a much older WebView than Android itself, if it never got the Play Store update. The game then failed
// before it could draw anything and sat on "Building the world..." for ever. This fills in what older versions lack, and
// if the game still doesn't get going it says why, on screen, instead of waiting without end.
(function () {
  'use strict';
  var N = window.Native;

  function fill(o, k, v) {
    if (o && !o[k]) Object.defineProperty(o, k, { value: v, writable: true, configurable: true });
  }
  fill(Object, 'hasOwn', function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); });
  function at(i) {
    var k = Math.trunc(i) || 0;
    return this[k < 0 ? this.length + k : k];
  }
  fill(Array.prototype, 'at', at);
  fill(String.prototype, 'at', function (i) { return at.call(String(this), i); });
  fill(Object.getPrototypeOf(Int8Array.prototype), 'at', at);
  // Without this every call to the server fails, as if there were no connection.
  if (window.AbortController) {
    fill(window.AbortSignal, 'timeout', function (ms) {
      var c = new AbortController();
      setTimeout(function () { c.abort(); }, ms);
      return c.signal;
    });
  }

  // ---------------------------------------------------------------- not getting going?
  var ERROR_WAIT = 5000, SLOW_WAIT = 45000;
  var TEXT = {
    en: ['StickManUp could not start', 'This phone has an old version of Android System WebView ({}), the part of Android the game runs on. Update it in the Play Store, then try again.', 'This browser is too old for the game. Please update it and try again.', 'Building the world is taking very long on this phone.', 'Something went wrong while starting. If it happens again, please send a picture of this screen to the makers.', 'Update WebView', 'Try again', 'Try simple graphics'],
    es: ['StickManUp no pudo iniciarse', 'Este teléfono tiene una versión antigua de Android System WebView ({}), la parte de Android en la que funciona el juego. Actualízala en Play Store y vuelve a intentarlo.', 'Este navegador es demasiado antiguo para el juego. Actualízalo y vuelve a intentarlo.', 'Construir el mundo está tardando mucho en este teléfono.', 'Algo salió mal al iniciar. Si vuelve a pasar, envía una foto de esta pantalla a los creadores.', 'Actualizar WebView', 'Reintentar', 'Probar gráficos simples'],
    pt: ['StickManUp não conseguiu iniciar', 'Este celular tem uma versão antiga do Android System WebView ({}), a parte do Android em que o jogo funciona. Atualize na Play Store e tente de novo.', 'Este navegador é antigo demais para o jogo. Atualize e tente de novo.', 'Construir o mundo está demorando muito neste celular.', 'Algo deu errado ao iniciar. Se acontecer de novo, envie uma foto desta tela aos criadores.', 'Atualizar WebView', 'Tentar de novo', 'Tentar gráficos simples'],
    fr: ['StickManUp n\'a pas pu démarrer', 'Ce téléphone a une ancienne version d\'Android System WebView ({}), la partie d\'Android sur laquelle tourne le jeu. Installe sa mise à jour dans le Play Store, puis réessaie.', 'Ce navigateur est trop ancien pour le jeu. Installe sa mise à jour, puis réessaie.', 'La construction du monde prend très longtemps sur ce téléphone.', 'Un problème est survenu au démarrage. Si cela se reproduit, envoie une photo de cet écran aux créateurs.', 'Mettre à jour WebView', 'Réessayer', 'Essayer les graphismes simples'],
    de: ['StickManUp konnte nicht starten', 'Dieses Handy hat eine alte Version von Android System WebView ({}), dem Teil von Android, auf dem das Spiel läuft. Aktualisiere sie im Play Store und versuche es dann noch einmal.', 'Dieser Browser ist zu alt für das Spiel. Bitte aktualisiere ihn und versuche es noch einmal.', 'Das Bauen der Welt dauert auf diesem Handy sehr lange.', 'Beim Start ist etwas schiefgelaufen. Wenn das wieder passiert, schick den Machern bitte ein Bild von diesem Bildschirm.', 'WebView aktualisieren', 'Noch einmal versuchen', 'Einfache Grafik versuchen'],
    ru: ['StickManUp не удалось запустить', 'На этом телефоне старая версия Android System WebView ({}), части Android, на которой работает игра. Обнови её в Play Store и попробуй снова.', 'Этот браузер слишком старый для игры. Обнови его и попробуй снова.', 'Создание мира на этом телефоне идёт очень долго.', 'При запуске произошла ошибка. Если это повторится, отправь снимок этого экрана создателям.', 'Обновить WebView', 'Попробовать снова', 'Попробовать простую графику'],
    tr: ['StickManUp başlatılamadı', 'Bu telefonda Android System WebView\'in eski bir sürümü var ({}). Oyun Android\'in bu bölümünde çalışır. Play Store\'dan güncelle ve tekrar dene.', 'Bu tarayıcı oyun için çok eski. Güncelle ve tekrar dene.', 'Dünyayı oluşturmak bu telefonda çok uzun sürüyor.', 'Başlatırken bir sorun oluştu. Tekrar olursa bu ekranın fotoğrafını yapımcılara gönder.', 'WebView\'i güncelle', 'Tekrar dene', 'Basit grafiği dene'],
  };
  var WEBVIEW_PAGE = 'https://play.google.com/store/apps/details?id=com.google.android.webview';

  var t0 = Date.now(), firstError = '', errorAt = 0, shown = '';

  function note(text) {
    if (firstError) return;
    firstError = String(text || 'unknown').slice(0, 220);
    errorAt = Date.now();
  }
  // The capture phase also catches a script file that can't load, which never reaches the window otherwise.
  window.addEventListener('error', function (e) {
    var el = e.target;
    if (el && el !== window && el.src) note('could not load ' + el.src);
    else note(e.message + (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    if (!window.SMU_booted && r) note('promise: ' + (r.message || r));
  });

  function words() {
    var pick = '';
    try { pick = JSON.parse(localStorage.getItem('smu.settings') || '{}').lang || ''; } catch (e) { pick = ''; }
    if (!pick || pick === 'auto') pick = String(navigator.language || 'en').slice(0, 2).toLowerCase();
    return TEXT[pick] || TEXT.en;
  }
  function engine() {
    var m = /Chrome\/(\d+)/.exec(navigator.userAgent);
    return m ? +m[1] : 0;
  }
  function restart() {
    if (N && N.restart) N.restart();
    else location.reload();
  }
  function button(text, primary, go) {
    var b = document.createElement('button');
    b.className = 'btn sm' + (primary ? ' primary' : '');
    b.textContent = text;
    b.addEventListener('click', go);
    return b;
  }

  function show(kind) {
    var box = document.getElementById('loading');
    if (!box || shown === kind) return;
    shown = kind;
    var old = document.getElementById('bootFail');
    if (old) old.parentNode.removeChild(old);
    var W = words(), ver = engine(), tooOld = kind === 'error' && ver > 0 && ver < 89;
    if (kind !== 'slow') box.classList.add('failed');
    var el = document.createElement('div');
    el.id = 'bootFail';
    var h = document.createElement('b');
    h.textContent = kind === 'slow' ? '' : W[0];
    var p = document.createElement('p');
    p.textContent = kind === 'slow' ? W[3] : tooOld ? (N ? W[1].replace('{}', String(ver)) : W[2]) : W[4];
    var row = document.createElement('div');
    row.className = 'row';
    if (tooOld && N && N.openUrl) row.appendChild(button(W[5], true, function () { N.openUrl(WEBVIEW_PAGE); }));
    row.appendChild(button(W[6], !tooOld && kind !== 'slow', restart));
    if (N && N.setSafe && (kind === 'slow' || !tooOld) && (N.getSafe ? N.getSafe() : 0) < 3) {
      row.appendChild(button(W[7], kind === 'slow', function () { N.setSafe(3); restart(); }));
    }
    var small = document.createElement('small');
    var android = /Android (\d+)/.exec(navigator.userAgent);
    small.textContent = (android ? 'Android ' + android[1] + ' · ' : '') + (ver ? 'Chrome ' + ver + ' · ' : '') + 'step ' + (window.SMU_stage || 'scripts') + (firstError ? ' · ' + firstError : '');
    if (h.textContent) el.appendChild(h);
    el.appendChild(p);
    el.appendChild(row);
    el.appendChild(small);
    box.appendChild(el);
  }

  function check() {
    if (window.SMU_booted) return;
    var now = Date.now();
    if (errorAt && now - errorAt > ERROR_WAIT) show('error');
    else if (now - t0 > SLOW_WAIT) show('slow');
    setTimeout(check, 1000);
  }
  setTimeout(check, 1000);
})();
