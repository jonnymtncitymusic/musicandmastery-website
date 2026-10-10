/**
 * Hero video ("The Mechanism"), Hormozi's way, on every landing page.
 *
 * acquisition.com/workshop (checked 2026-10-06) starts its sales video MUTED by itself under
 * the headline, with a "Your Video Is Playing / Click To Unmute" overlay and the CTA right
 * below. Jonny's rule is to do what Hormozi does, so the pages carry the YouTube iframe in the
 * HTML with autoplay=1&mute=1 and no thumbnail in front of it (his call, 2026-10-06). Its
 * address sits in data-src and this file sets it once the page has painted (see loadPlayer).
 *
 * When the video is actually playing, a "Your video is playing / Tap to unmute" card appears
 * over it. A tap on the card restarts it from the top with sound (measured in Chrome, phone
 * and desktop: one tap, playing, unmuted). A tap inside the YouTube player itself does NOT
 * unmute, which is why the card exists.
 *
 * If muted autoplay is blocked (data saver, iPhone Low Power Mode) the card never shows and
 * YouTube's own play button is what the visitor sees, which plays with sound on one tap.
 *
 * YouTube's caption box stays off (Jonny 2026-10-06, again 2026-10-07). cc_load_policy=0 does not
 * beat a viewer whose YouTube account has captions switched on, and switching them off only once
 * the video was PLAYING left "What" on screen at 0:00 while it buffered (seen 2026-10-07). So they
 * are switched off the moment the player first reports in, and again on every play or buffer.
 * The words in the video are part of the file.
 *
 * GA4: vsl_autoplay = the muted video started; vsl_play = the visitor tapped for sound.
 */
(function () {
  var box = document.querySelector('.hero-vsl');
  if (!box) return;
  var iframe = box.querySelector('iframe');
  var btn = box.querySelector('.hero-vsl-btn');
  if (!iframe || !btn) return;
  var page = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '');
  var lastState = null;

  function track(name) {
    try { if (typeof gtag === 'function') gtag('event', name, { video: 'the_mechanism', page: page }); } catch (e) {}
  }
  function send(func, args) {
    try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), '*'); } catch (e) {}
  }

  function captionsOff() {
    send('unloadModule', ['captions']);
    send('unloadModule', ['cc']);
    send('setOption', ['captions', 'track', {}]);
  }

  window.addEventListener('message', function (e) {
    if (e.source !== iframe.contentWindow) return;
    try {
      var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (!d) return;
      if (lastState === null) { lastState = -2; stopAsking(); captionsOff(); }
      if (!d.info || typeof d.info.playerState !== 'number') return;
      var state = d.info.playerState;
      if (state !== lastState) {
        lastState = state;
        // 1 = playing, 3 = buffering: the moments YouTube re-applies the viewer's caption setting.
        if (state === 1 || state === 3) captionsOff();
      }
      if (state === 1 && !box.classList.contains('is-live')) { box.classList.add('is-live'); track('vsl_autoplay'); }
    } catch (x) {}
  });

  // The player only reports its state once it has been told someone is listening. The iframe is
  // loading="lazy", so the player can arrive long after this script runs (a slow phone, or a
  // visitor who scrolls late): ask again for a minute after every iframe load, and stop at the
  // player's first reply.
  var ask = null, giveUp = null;
  function stopAsking() { clearInterval(ask); clearTimeout(giveUp); ask = giveUp = null; }
  function startAsking() {
    if (lastState !== null) return;
    stopAsking();
    ask = setInterval(function () {
      try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'hero-vsl' }), '*'); } catch (x) {}
    }, 400);
    giveUp = setTimeout(stopAsking, 60000);
  }
  iframe.addEventListener('load', startAsking);
  startAsking();

  // The player starts loading once the page itself has painted (website speed, 2026-10-10).
  // Its ~900 KB of YouTube script used to download alongside the headline and the fonts, which
  // is most of why Google scored these pages at 12 s on a phone. The page carries the address
  // in data-src; the box shows its dark background until the player arrives, as it always did.
  function loadPlayer() {
    var src = iframe.getAttribute('data-src');
    if (src && !iframe.getAttribute('src')) iframe.setAttribute('src', src);
  }
  if (document.readyState === 'complete') loadPlayer();
  else window.addEventListener('load', loadPlayer);

  btn.addEventListener('click', function () {
    box.classList.add('is-engaged');
    track('vsl_play');
    send('seekTo', [0, true]); send('unMute'); send('setVolume', [100]); send('playVideo');
    captionsOff();
  });
})();
