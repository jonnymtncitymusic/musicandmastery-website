/**
 * The hero video player, Hormozi's way, for any page whose video id lives in js/vsl-ids.js
 * (VSLs in the signup process, ~/brainstorms/2026-11-13-vsls-in-signup-process.md).
 *
 * A port of musicandmastery.com's js/hero-vsl.js, behaviour unchanged, and the same file on both
 * brand sites. The one difference: the page names WHICH video with data-vsl on the box
 * (<div class="hero-vsl" data-vsl="vsl_b">), and the YouTube id comes from window.VSL_IDS in
 * js/vsl-ids.js, so swapping a video is one edit there. Load vsl-ids.js before this file.
 * The data-vsl key is also the GA4 'video' value ('vsl_b', 'vsl_a_lead', 'vsl_a_booked').
 *
 * What the player does (measured on the M&M pages, 2026-10-06 to 2026-11-11):
 * - Starts MUTED by itself once the page has painted, with no thumbnail in front of it
 *   (acquisition.com/workshop did this; Jonny's call 2026-10-06).
 * - While it plays, a "Your video is playing / Tap to unmute" card sits over it. A tap on the card
 *   restarts it from the top with sound. A tap inside the YouTube player does NOT unmute, which is
 *   why the card exists.
 * - If muted autoplay is blocked (data saver, iPhone Low Power Mode) the card never shows and
 *   YouTube's own play button plays it with sound on one tap.
 * - YouTube's caption box stays off: switched off the moment the player first reports in, and
 *   again on every play or buffer, because a viewer's own YouTube setting beats cc_load_policy=0.
 * - The address is set only after the page's first contentful paint plus one frame. Pointing the
 *   iframe at YouTube earlier holds the page's whole first frame until YouTube's frame is ready
 *   (M&M trace, 2026-10-19).
 *
 * GA4: vsl_autoplay = the muted video started; vsl_play = the visitor tapped for sound. Both carry
 * video (the data-vsl key), page, and src (the page's ?src= value, when there is one).
 */
(function () {
  var box = document.querySelector('.hero-vsl[data-vsl]');
  if (!box) return;
  var iframe = box.querySelector('iframe');
  var btn = box.querySelector('.hero-vsl-btn');
  if (!iframe || !btn) return;
  var key = box.getAttribute('data-vsl');
  var id = (window.VSL_IDS || {})[key];
  // No id, no black box: a page whose video is not set hides the player rather than show an
  // empty frame.
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) { box.hidden = true; return; }

  var page = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '');
  var src = '';
  try { src = (new URLSearchParams(location.search).get('src') || '').slice(0, 40); } catch (e) {}
  var lastState = null;

  function track(name) {
    var p = { video: key, page: page };
    if (src) p.src = src;
    try { if (typeof gtag === 'function') gtag('event', name, p); } catch (e) {}
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

  // The player only reports its state once it has been told someone is listening, and it can
  // arrive long after this script runs: ask again for a minute after every iframe load, and stop
  // at the player's first reply.
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

  function loadPlayer() {
    if (iframe.getAttribute('src')) return;
    iframe.setAttribute('src', 'https://www.youtube-nocookie.com/embed/' + id +
      '?autoplay=1&mute=1&rel=0&playsinline=1&cc_load_policy=0&iv_load_policy=3&enablejsapi=1');
  }
  function afterNextFrame() {
    requestAnimationFrame(function () { setTimeout(loadPlayer, 0); });
  }
  function whenPainted() {
    try {
      if (performance.getEntriesByName('first-contentful-paint').length) { afterNextFrame(); return; }
      if (window.PerformanceObserver && (PerformanceObserver.supportedEntryTypes || []).indexOf('paint') !== -1) {
        var po = new PerformanceObserver(function (list) {
          if (list.getEntriesByName('first-contentful-paint').length) { po.disconnect(); afterNextFrame(); }
        });
        po.observe({ type: 'paint', buffered: true });
        return;
      }
    } catch (e) {}
    setTimeout(loadPlayer, 1500);
  }
  if (document.readyState === 'complete') whenPainted();
  else window.addEventListener('load', whenPainted);

  btn.addEventListener('click', function () {
    box.classList.add('is-engaged');
    track('vsl_play');
    send('seekTo', [0, true]); send('unMute'); send('setVolume', [100]); send('playVideo');
    captionsOff();
  });
})();
