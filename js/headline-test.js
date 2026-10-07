/**
 * Headline split test on the paid landing pages (Hormozi teardown edit #7, Jonny 2026-10-07).
 *
 * Hormozi runs one split test a week, headline first, because "the biggest jumps in conversion
 * rate happen above the fold". Each paid page carries its challenger in its <h1>:
 *
 *   <h1 class="hero-heading" data-hl-test="oc-piano-h1-2026-10-07" data-hl-b="...">A</h1>
 *   <script>...inline...</script>
 *
 * The inline script right after the <h1> picks the headline before the page paints (50/50,
 * kept in localStorage so a returning visitor sees the same one) and marks the <h1> with
 * data-hl-variant. ?hl=a or ?hl=b forces one for a preview and is never counted. The server
 * HTML is always A, so search engines and no-JS visitors see A.
 *
 * This file reports, as a text/plain beacon (no CORS preflight) to the scheduling server, which
 * keeps the counts and emails Jonny every Monday (mcmc-cron-runner api/headline_test.py,
 * scripts/headline-test/headline_report.py):
 *   view      once per browser session per test
 *   book_tap  a tap on any "Book" button (href="#form"), once per browser session per test
 *   call_tap  a tap on the phone number, once per browser session per test
 *   convert   on thank-you.html after a real submission (its own gate), if this browser saw
 *             a test page in the last 7 days
 * Each beacon carries a random browser id, never anything about the person. A copy goes to GA4
 * as hl_<event> for anyone who wants it there too.
 *
 * Served from /js/ (immutable for a year), so pages load it as headline-test.js?v=<hash>;
 * npm test fails on a stale token.
 */
(function () {
  var API = 'https://cron-runner-production-a510.up.railway.app/api/hl/event';
  var LAST = 'mm_hl_last';
  var WEEK = 7 * 24 * 3600 * 1000;

  function local() { try { return window.localStorage; } catch (e) { return null; } }
  function session() { try { return window.sessionStorage; } catch (e) { return null; } }
  function get(s, k) { try { return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function set(s, k, v) { try { if (s) s.setItem(k, v); } catch (e) {} }
  function page() { return (location.pathname.split('/').pop() || 'index').toLowerCase(); }

  function browserId() {
    var id = get(local(), 'mm_hl_cid');
    if (id && /^[a-z0-9]{8,40}$/.test(id)) return id;
    id = '';
    while (id.length < 20) id += Math.random().toString(36).slice(2);
    id = id.replace(/[^a-z0-9]/g, '').slice(0, 20);
    set(local(), 'mm_hl_cid', id);
    return id;
  }

  // Only the live site reports. Local previews, test harnesses and staging copies load this
  // same file, and on 2026-10-07 a local npm test run wrote rows into the live table before
  // this guard existed. A harness that wants to see the beacons sets window.MM_HL_FORCE_SEND.
  var LIVE = /(^|\.)musicandmastery\.com$/.test(location.hostname);

  function send(test, variant, event, detail) {
    if (!LIVE && !window.MM_HL_FORCE_SEND) return;
    var body = JSON.stringify({ test: test, variant: variant, event: event, cid: browserId(),
      page: page(), detail: (detail || '').replace(/\s+/g, ' ').trim().slice(0, 200) });
    var sent = false;
    try { sent = !!(navigator.sendBeacon && navigator.sendBeacon(API, new Blob([body], { type: 'text/plain' }))); } catch (e) {}
    if (!sent) {
      try { fetch(API, { method: 'POST', body: body, keepalive: true, mode: 'no-cors', headers: { 'Content-Type': 'text/plain' } }); } catch (e) {}
    }
    try { if (typeof gtag === 'function') gtag('event', 'hl_' + event, { hl_test: test, hl_variant: variant }); } catch (e) {}
  }

  function onTestPage(h1) {
    var test = h1.getAttribute('data-hl-test');
    var variant = h1.getAttribute('data-hl-variant');
    if (!test || (variant !== 'a' && variant !== 'b')) return;
    if (h1.hasAttribute('data-hl-preview')) return;   // ?hl= preview, never counted

    set(local(), LAST, JSON.stringify({ test: test, variant: variant, at: Date.now() }));
    var seenKey = 'mm_hl_seen_' + test;
    if (!get(session(), seenKey)) {
      set(session(), seenKey, '1');
      send(test, variant, 'view', h1.textContent);
    }
    var tapped = {};   // backs up sessionStorage when it is blocked
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      var event = href === '#form' ? 'book_tap' : href.indexOf('tel:') === 0 ? 'call_tap' : null;
      if (!event) return;
      var tapKey = 'mm_hl_' + event + '_' + test;
      if (tapped[event] || get(session(), tapKey)) return;
      tapped[event] = true;
      set(session(), tapKey, '1');
      send(test, variant, event);
    }, true);
  }

  // thank-you.html's own gate decides what a real submission is (an allowed ?type=, not a
  // reload or a Back) and sets window.MM_SUBMISSION on its window 'load'. This listener is
  // added later than the gate's, so it runs after it.
  function onThankYou() {
    if (document.readyState === 'complete') convertIfSubmitted();
    else window.addEventListener('load', convertIfSubmitted);
  }

  function convertIfSubmitted() {
    var type = window.MM_SUBMISSION;
    if (!type) return;
    var last;
    try { last = JSON.parse(get(local(), LAST) || 'null'); } catch (e) { last = null; }
    if (!last || !last.test || (last.variant !== 'a' && last.variant !== 'b')) return;
    if (!(Date.now() - last.at < WEEK)) return;
    var doneKey = 'mm_hl_conv_' + last.test;
    if (get(local(), doneKey)) return;   // one conversion per browser per test
    set(local(), doneKey, '1');
    send(last.test, last.variant, 'convert', type);
  }

  function start() {
    var h1 = document.querySelector('h1[data-hl-test]');
    if (h1) onTestPage(h1);
    else if (/thank-you/.test(page())) onThankYou();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
