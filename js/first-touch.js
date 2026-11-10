/* First-touch ad tags for the Conversions page (2026-11-09). Loaded on every page, so a visitor who lands on a page
 * that opens the booking widget only on demand is still credited to the ad, search or site that brought them.
 * The booking widget (js/scheduling-widget.js) runs the same code and sends what this stored. */
(function () {
  'use strict';
  // First-touch ad tags (Conversions by source, 2026-11-09): which ad, search or site first brought this
  // visitor, kept 90 days in this browser (or this tab's session when local storage is blocked) and sent with a
  // lead or a booking, so the hub can credit the source. Only the ad parameters, the referring site's host and
  // the landing path: never anything the visitor typed. Only a visit that carries ad tags or comes from another
  // site is kept, and the first one kept is never replaced; a visit from our own pages with no tags is sent with
  // that one request only, so it can never lock in "direct" ahead of a real ad click. The same code runs from
  // js/first-touch.js on every page (pages that load the booking widget only when it opens).
  var FIRST_TOUCH_KEY = 'mcmc_first_touch';
  var FIRST_TOUCH_DAYS = 90;
  var FIRST_TOUCH_TAGS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
                          'gclid', 'gbraid', 'wbraid', 'fbclid'];
  function ftStores() {
    var out = [];
    try { if (window.localStorage) out.push(window.localStorage); } catch (e) { /* blocked */ }
    try { if (window.sessionStorage) out.push(window.sessionStorage); } catch (e) { /* blocked */ }
    return out;
  }
  function ftBareHost(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }
  function readFirstTouch() {
    var stores = ftStores();
    for (var i = 0; i < stores.length; i++) {
      try {
        var t = JSON.parse(stores[i].getItem(FIRST_TOUCH_KEY) || 'null');
        if (t && typeof t === 'object' && t.first_seen &&
            (Date.now() - Date.parse(t.first_seen)) < FIRST_TOUCH_DAYS * 864e5) return t;
      } catch (e) { /* unreadable: try the next store */ }
    }
    return null;
  }
  function captureFirstTouch() {
    var stored = readFirstTouch();
    if (stored) return stored;
    var t = { first_seen: new Date().toISOString() };
    var meaningful = false;
    try {
      var q = new URLSearchParams(window.location.search);
      FIRST_TOUCH_TAGS.forEach(function (k) { var v = q.get(k); if (v) { t[k] = v.slice(0, 200); meaningful = true; } });
    } catch (e) { /* no URLSearchParams: no tags */ }
    try {
      if (document.referrer) {
        var h = new URL(document.referrer).hostname;
        if (h && ftBareHost(h) !== ftBareHost(window.location.hostname)) { t.referrer = h.slice(0, 200); meaningful = true; }
      }
    } catch (e) { /* unreadable referrer */ }
    t.landing = String(window.location.pathname || '/').slice(0, 200);
    if (meaningful) {
      var stores = ftStores();
      for (var i = 0; i < stores.length; i++) {
        try { stores[i].setItem(FIRST_TOUCH_KEY, JSON.stringify(t)); break; } catch (e) { /* try the next store */ }
      }
    }
    return t;
  }
  captureFirstTouch();
})();
