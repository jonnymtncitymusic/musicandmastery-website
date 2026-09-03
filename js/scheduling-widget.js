/**
 * MCMC Scheduling Widget
 * Vanilla JS booking widget for mtncitymusic.com
 * Replaces JotForm modal with real-time availability scheduling.
 */
(function() {
  'use strict';

  // ─── Config ────────────────────────────────────────────────────────────────
  // Update this to your Railway URL after deployment
  const API_BASE = window.MCMC_SCHEDULING_API || 'http://localhost:8090';

  // Brand source — distinguishes leads in the Lead Drip sheet
  // 'mcmc' (default) = Mountain City Music Co | 'musicandmastery' = Music & Mastery
  const BRAND_SOURCE = window.MCMC_BRAND_SOURCE || 'mcmc';

  // Optional: where to send the user after successful lead capture
  // (e.g. 'https://www.musicandmastery.com/thank-you.html' for Google Ads conversion).
  // If unset, shows the inline confirmation step.
  const THANK_YOU_REDIRECT = window.MCMC_THANK_YOU_REDIRECT || null;
  // Names the region a MULTI-city landing page serves. The 24 single-city pages set
  // MCMC_PREFILL_CITY and get their city that way; the paid Orange County page covers
  // five cities so it cannot, and it was falling through to the words "your area" -- a
  // visitor who searched "piano lessons irvine" was answered with "instructors in your
  // area". Empty means say nothing rather than say something vague.
  const AREA_LABEL = window.MCMC_AREA_LABEL || '';

  // Lead-only mode skips the availability search entirely and shows a single
  // contact form. Auto-on when brand source isn't MCMC (since other brands
  // don't have instructor availability data wired in).
  const LEAD_ONLY = window.MCMC_LEAD_ONLY || (BRAND_SOURCE !== 'mcmc');

  // Phone-first field order, opt-in PER PAGE.
  //
  // LEAD_ONLY is on for every non-MCMC page, so reordering the fields
  // unconditionally would silently change the form on all 35 M&M pages to serve
  // one paid landing page. This flag keeps the blast radius at whichever page
  // sets it, and reverts by deleting one line from that page.
  const PHONE_FIRST = !!window.MCMC_PHONE_FIRST;

  const INSTRUMENTS = ['Guitar', 'Piano', 'Voice', 'Bass', 'Ukulele', 'Drums', 'Music Production', 'Other'];

  // ─── Deep links ────────────────────────────────────────────────────────────
  // /?book=piano preselects piano. Slugs are DERIVED from INSTRUMENTS, so the
  // accepted set cannot drift from the set the form actually offers.
  // 'Other' is deliberately excluded: it opens a free-text field, and nothing
  // outside this file gets to put text in front of a visitor.
  // Object.create(null), not {}: a plain object literal resolves inherited keys,
  // so ?book=constructor came back as the Object function, sailed past the
  // "is an instrument set?" guard, and then vanished from the JSON payload.
  const BOOK_SLUGS = Object.create(null);
  INSTRUMENTS.forEach(function (name) {
    if (name !== 'Other') BOOK_SLUGS[name.toLowerCase().replace(/\s+/g, '-')] = name;
  });

  // Returns a canonical member of INSTRUMENTS, or ''. The raw parameter is used
  // ONLY as a lookup key. It is never written to the DOM, into the form, or into
  // the submitted payload, so an unrecognised or hostile value can do nothing
  // except fail to match.
  //
  // A ?book= value outranks the page default, so ?book=voice on the piano
  // landing page means voice.
  function requestedInstrument() {
    let raw = '';
    try { raw = new URLSearchParams(window.location.search).get('book') || ''; } catch (e) {}
    // Checked against INSTRUMENTS on the way out as well as on the way in. The
    // map is the lookup; this is the invariant, and it holds even if the map is
    // ever rebuilt from something less careful.
    const fromUrl = BOOK_SLUGS[raw.trim().toLowerCase()];
    if (typeof fromUrl === 'string' && INSTRUMENTS.indexOf(fromUrl) !== -1) return fromUrl;
    const pageDefault = window.MCMC_PREFILL_INSTRUMENT;
    if (typeof pageDefault === 'string' && INSTRUMENTS.indexOf(pageDefault) !== -1) return pageDefault;
    return '';
  }

  // Presence, not value. A ?book with no usable instrument still means the
  // visitor asked to book, so the form is still brought to them.
  function bookParamPresent() {
    try { return new URLSearchParams(window.location.search).has('book'); } catch (e) { return false; }
  }

  // Bring an inline page's form to the visitor when they arrived on a booking
  // link. Only ever called when ?book is present, so ordinary and paid traffic
  // on these pages is untouched.
  function scrollToInlineForm() {
    const target = document.getElementById('form') || document.getElementById('scheduling-widget');
    if (!target) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = reduce ? 'auto' : 'smooth';
    // Images above the form, and the form itself, finish sizing AFTER this first
    // runs. That slides the target out from under a smooth scroll already in
    // flight and lands 150-220px short of it on a fast connection, measured.
    //
    // So re-aim, but ONLY when the document height actually changed, because
    // that is the one thing that can invalidate the target. Once the page has
    // settled this stops issuing scrolls entirely, which is what keeps a visitor
    // who took over from being yanked back: dragging the scrollbar fires no
    // wheel, touch or key event, so the listeners below cannot be the only
    // guard. They stop it early when they do fire.
    const EVENTS = ['wheel', 'touchstart', 'keydown'];
    let ticks = 0, lastHeight = -1, done = false;
    function stop() {
      done = true;
      EVENTS.forEach(function (evt) { window.removeEventListener(evt, stop); });
    }
    EVENTS.forEach(function (evt) { window.addEventListener(evt, stop, { passive: true }); });
    (function aim() {
      if (done) return;
      const height = document.documentElement.scrollHeight;
      if (height !== lastHeight) {
        lastHeight = height;
        target.scrollIntoView({ behavior, block: 'start' });
      }
      if (++ticks >= 12) { stop(); return; }
      setTimeout(aim, 250);
    })();
  }
  // Lesson length labels carry no price. The first lesson is free on both
  // brands, and the standard per-lesson rate is shown as post-trial
  // information in the bucket hint below, never charged at booking.
  // Ordered most-expensive-first to match the rate card on every page. The 45
  // is the anchor and is the default selection below, never the 30.
  const LESSON_LENGTHS = [
    { value: 60, label: '60 min' },
    { value: 45, label: '45 min' },
    { value: 30, label: '30 min' },
  ];

  // Standard per-lesson rates, charged only AFTER the free first lesson.
  // Keys match LESSON_LENGTHS[].value. The first lesson is never charged.
  const STANDARD_RATES = { 30: 40, 45: 60, 60: 75 };

  // What the customer is actually SHOWN. Every other surface on both sites quotes a
  // monthly rate against four weekly lessons, so the widget does too. A per-lesson
  // unit price reads as proration, and we have no proration policy to stand behind.
  const MONTHLY_RATES = { 30: 160, 45: 240, 60: 300 };

  // ─── State ─────────────────────────────────────────────────────────────────
  function freshState() {
    return {
      step: 1,
      mode: 'booking',  // 'booking' or 'lead' (no-match flow)
      instrument: '',
      instrumentOther: '',  // free-text when instrument === 'Other'
      city: '',
      address: '',
      lessonLength: 45,   // the anchor tier, never the shortest
      preferredDays: [],     // array of day-of-week ints (0=Mon..6=Sun)
      preferredTimes: [],    // array of strings: 'morning' | 'afternoon' | 'evening'
      cities: [],
      slots: null,
      selectedSlot: null,
      filterInstructor: '',
      clientName: '',
      clientEmail: '',
      clientPhone: '',
      studentAge: '',
      lessonFor: '',    // 'child' | 'self'. Empty until answered; the API treats empty as unknown.
      startTiming: '',  // 'asap' | 'within_month' | 'exploring'
      notes: '',
      loading: false,
      error: '',           // global/system errors (network, payment, server)
      fieldErrors: {},     // per-field validation errors keyed by field id
      confirmation: null,
    };
  }

  // Helpers for inline field errors
  function setFieldError(field, msg) {
    state.fieldErrors[field] = msg;
  }
  function clearFieldError(field) {
    if (state.fieldErrors[field]) delete state.fieldErrors[field];
  }
  function clearAllErrors() {
    state.error = '';
    state.fieldErrors = {};
  }
  // Render an inline error message + apply error class to a field
  function fieldErrorHtml(field) {
    const msg = state.fieldErrors[field];
    return msg ? `<div class="sw-field-error-msg">${msg}</div>` : '';
  }
  function fieldErrorClass(field) {
    return state.fieldErrors[field] ? 'sw-field-error' : '';
  }

  const DAYS_OF_WEEK = [
    { v: 0, label: 'Mon' }, { v: 1, label: 'Tue' }, { v: 2, label: 'Wed' },
    { v: 3, label: 'Thu' }, { v: 4, label: 'Fri' }, { v: 5, label: 'Sat' },
    { v: 6, label: 'Sun' },
  ];
  const TIME_BUCKETS = [
    { key: 'morning',   label: 'Morning',   range: { start: '08:00', end: '12:00' } },
    { key: 'afternoon', label: 'Afternoon', range: { start: '12:00', end: '17:00' } },
    { key: 'evening',   label: 'Evening',   range: { start: '17:00', end: '21:00' } },
  ];
  let state = freshState();

  // ─── API ───────────────────────────────────────────────────────────────────
  async function fetchCities() {
    const res = await fetch(`${API_BASE}/api/scheduling/cities`);
    if (!res.ok) throw new Error('Could not load cities');
    const data = await res.json();
    return data.cities || [];
  }

  async function fetchAvailability(params) {
    const res = await fetch(`${API_BASE}/api/scheduling/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Could not load availability');
    return res.json();
  }

  async function bookLesson(params) {
    const res = await fetch(`${API_BASE}/api/scheduling/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.status === 409) {
      const data = await res.json();
      throw new Error(data.detail || 'This slot is no longer available.');
    }
    if (res.status === 429) {
      throw new Error('Too many requests. Please try again later.');
    }
    if (!res.ok) throw new Error('Booking failed. Please try again.');
    return res.json();
  }

  function buildRedirectUrl(params) {
    const url = new URL(THANK_YOU_REDIRECT, window.location.origin);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    });
    return url.toString();
  }

  async function submitLead(params) {
    const res = await fetch(`${API_BASE}/api/scheduling/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.status === 429) throw new Error('Too many requests. Please try again later.');
    if (!res.ok) throw new Error('Submission failed. Please try again.');
    return res.json();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function formatTime(time24) {
    const [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
  }

  function groupSlotsByDay(slots) {
    const groups = {};
    for (const slot of slots) {
      const key = `${slot.date}_${slot.day}`;
      if (!groups[key]) groups[key] = { date: slot.date, day: slot.day, slots: [] };
      groups[key].slots.push(slot);
    }
    return Object.values(groups);
  }

  function getUniqueInstructors(slots) {
    const seen = new Set();
    const instructors = [];
    for (const s of slots) {
      if (!seen.has(s.instructor_id)) {
        seen.add(s.instructor_id);
        instructors.push({ id: s.instructor_id, name: s.instructor_name });
      }
    }
    return instructors;
  }

  const LESSON_FOR_OPTIONS = [
    { v: 'child', label: 'My child' },
    { v: 'self',  label: 'Myself' },
  ];

  // One helper for all three forms (booking, no-match lead, lead-only). The three
  // used to differ in what they asked, which is how the booking path ended up
  // with no student information at all.
  function renderLessonForField() {
    return `
      <div class="sw-field ${fieldErrorClass('lessonFor')}">
        <span class="sw-label" id="sw-lessonfor-label">Who is this lesson for?</span>
        <div class="sw-pill-row" role="group" aria-labelledby="sw-lessonfor-label">
          ${LESSON_FOR_OPTIONS.map(o => `
            <button type="button" class="sw-pill ${state.lessonFor === o.v ? 'sw-pill-on' : ''}" aria-pressed="${state.lessonFor === o.v ? 'true' : 'false'}" data-lessonfor="${o.v}">${o.label}</button>
          `).join('')}
        </div>
        ${fieldErrorHtml('lessonFor')}
      </div>
    `;
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('scheduling-widget');
    if (!container) return;

    // A render replaces the entire subtree, so remember what the visitor was
    // doing first. The instrument select is the first field on the lead form
    // and changing it re-renders; without this, focus drops to <body> and a
    // keyboard visitor has to Tab back in from the top of the page. Ported
    // from the mtncitymusic copy, which had it first.
    const active = document.activeElement;
    const focusId = active && active.id && container.contains(active) ? active.id : null;
    const hasSel = focusId && typeof active.selectionStart === 'number';
    const selStart = hasSel ? active.selectionStart : null;
    const selEnd = hasSel ? active.selectionEnd : null;

    let html = '';

    if (state.error) {
      html += `<div class="sw-error">${state.error}</div>`;
    }

    switch (state.step) {
      case 1: html += renderStep1(); break;
      case 2: html += renderStep2(); break;
      case 3: html += renderStep3(); break;
      case 4: html += renderStep4(); break;
      case 5: html += renderStep5(); break;
    }

    container.innerHTML = html;
    bindEvents();

    if (focusId) {
      const restored = document.getElementById(focusId);
      if (restored) {
        restored.focus();
        // setSelectionRange throws on input types that do not support it
        // (email, number) in some browsers, so this is best-effort.
        if (selStart !== null && typeof restored.setSelectionRange === 'function') {
          try { restored.setSelectionRange(selStart, selEnd); } catch (e) {}
        }
      }
    }
  }

  function renderStep1() {
    const cityOptions = state.cities.map(c =>
      `<option value="${c}" ${state.city === c ? 'selected' : ''}>${c}</option>`
    ).join('');

    const instrumentOptions = INSTRUMENTS.map(i =>
      `<option value="${i}" ${state.instrument === i ? 'selected' : ''}>${i}</option>`
    ).join('');

    const lengthOptions = LESSON_LENGTHS.map(l =>
      `<option value="${l.value}" ${state.lessonLength === l.value ? 'selected' : ''}>${l.label}</option>`
    ).join('');

    return `
      <div class="sw-step">
        ${LEAD_ONLY ? '' : `
          <div class="sw-trial-banner">
            <div class="sw-trial-banner-eyebrow">Free First Lesson</div>
            <div class="sw-trial-banner-headline">Your first lesson is free</div>
          </div>
        `}
        <h3 class="sw-heading">Find Your Perfect Lesson</h3>
        <p class="sw-subtext">Tell us what you're looking for and we'll match you with the best instructor.</p>

        <div class="sw-field ${fieldErrorClass('instrument')}">
          <label class="sw-label" for="sw-instrument">Instrument</label>
          <select id="sw-instrument" class="sw-select">
            <option value="">Choose an instrument...</option>
            ${instrumentOptions}
          </select>
          ${fieldErrorHtml('instrument')}
        </div>

        ${state.instrument === 'Other' ? `
          <div class="sw-field ${fieldErrorClass('instrumentOther')}">
            <label class="sw-label" for="sw-instrument-other">Which instrument?</label>
            <input type="text" id="sw-instrument-other" class="sw-input" placeholder="e.g., Violin, Saxophone, Drums" value="${state.instrumentOther}">
            ${fieldErrorHtml('instrumentOther')}
          </div>
        ` : ''}

        <div class="sw-field ${fieldErrorClass('city')}">
          <label class="sw-label" for="sw-city">Your City</label>
          <select id="sw-city" class="sw-select">
            <option value="">Choose your city...</option>
            ${cityOptions}
          </select>
          ${fieldErrorHtml('city')}
        </div>

        <div class="sw-field">
          <label class="sw-label" for="sw-length">Lesson Length</label>
          <select id="sw-length" class="sw-select">
            ${lengthOptions}
          </select>
          <div class="sw-bucket-hint">Your first lesson is free. After that it's $300/mo for 60 minutes, $240/mo for 45, or $160/mo for 30, based on four weekly lessons a month.</div>
        </div>

        <div class="sw-field">
          <label class="sw-label" for="sw-address">Your Address <span class="sw-optional">(optional, for more accurate matching)</span></label>
          <input type="text" id="sw-address" class="sw-input" placeholder="123 Main St" value="${state.address}">
        </div>

        <div class="sw-field">
          <span class="sw-label" id="sw-days-label">Preferred Days <span class="sw-optional">(optional, leave blank for any day)</span></span>
          <div class="sw-pill-row" role="group" aria-labelledby="sw-days-label">
            ${DAYS_OF_WEEK.map(d => `
              <button type="button" class="sw-pill ${state.preferredDays.includes(d.v) ? 'sw-pill-on' : ''}" aria-pressed="${state.preferredDays.includes(d.v) ? 'true' : 'false'}" data-day="${d.v}">${d.label}</button>
            `).join('')}
          </div>
        </div>

        <div class="sw-field">
          <span class="sw-label" id="sw-times-label">Preferred Times <span class="sw-optional">(optional)</span></span>
          <div class="sw-pill-row" role="group" aria-labelledby="sw-times-label">
            ${TIME_BUCKETS.map(t => `
              <button type="button" class="sw-pill ${state.preferredTimes.includes(t.key) ? 'sw-pill-on' : ''}" aria-pressed="${state.preferredTimes.includes(t.key) ? 'true' : 'false'}" data-time="${t.key}">${t.label}</button>
            `).join('')}
          </div>
          <div class="sw-bucket-hint">Morning 8a–12p · Afternoon 12p–5p · Evening 5p–9p</div>
        </div>

        <button id="sw-find" class="sw-btn sw-btn-primary" ${state.loading ? 'disabled' : ''}>
          ${state.loading ? '<span class="sw-spinner"></span> Searching...' : 'Find Available Times'}
        </button>
      </div>
    `;
  }

  function renderStep2() {
    const allSlots = [];
    if (state.slots?.recommended) allSlots.push(state.slots.recommended);
    if (state.slots?.alternatives) allSlots.push(...state.slots.alternatives);

    if (allSlots.length === 0) {
      return `
        <div class="sw-step">
          <h3 class="sw-heading">No Available Slots</h3>
          <p class="sw-subtext">${state.slots?.message || 'No instructors are available for your selection in the next 2 weeks.'}</p>
          <button id="sw-back-1" class="sw-btn sw-btn-secondary">Try Different Options</button>
        </div>
      `;
    }

    // Filter by instructor if set
    const filtered = state.filterInstructor
      ? allSlots.filter(s => s.instructor_name === state.filterInstructor)
      : allSlots;

    const instructors = getUniqueInstructors(allSlots);
    const instructorFilter = instructors.length > 1 ? `
      <div class="sw-field">
        <label class="sw-label" for="sw-filter-instructor">Filter by instructor</label>
        <select id="sw-filter-instructor" class="sw-select">
          <option value="">All instructors</option>
          ${instructors.map(i => `<option value="${i.name}" ${state.filterInstructor === i.name ? 'selected' : ''}>${i.name}</option>`).join('')}
        </select>
      </div>
    ` : '';

    const groups = groupSlotsByDay(filtered);

    // Compose a stable identity key for each slot so equality checks survive
    // round-trips through JSON.parse(button.dataset.slot).
    const slotKey = s => s ? `${s.instructor_id}|${s.date}|${s.time}` : '';
    const recommendedKey = state.slots?.recommended ? slotKey(state.slots.recommended) : '';
    const selectedKey = slotKey(state.selectedSlot);
    const hasSelection = !!state.selectedSlot;

    let slotsHtml = '';
    for (const group of groups) {
      slotsHtml += `<div class="sw-day-group">`;
      slotsHtml += `<div class="sw-day-label">${group.day}, ${new Date(group.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>`;
      slotsHtml += `<div class="sw-slots-row">`;
      for (const slot of group.slots) {
        const thisKey = slotKey(slot);
        const isSelected = thisKey === selectedKey;
        // Only show 'Best Match' treatment when nothing is selected, OR when
        // the recommended slot IS what's selected. This way picking a different
        // time visually demotes the previously-recommended slot back to normal.
        const showAsRecommended = thisKey === recommendedKey
          && !state.filterInstructor
          && (!hasSelection || isSelected);
        slotsHtml += `
          <button class="sw-slot ${isSelected ? 'sw-slot-selected' : ''} ${showAsRecommended ? 'sw-slot-recommended' : ''}"
                  data-slot='${JSON.stringify(slot)}'>
            ${showAsRecommended ? '<span class="sw-badge">Best Match</span>' : ''}
            ${isSelected ? '<span class="sw-badge sw-badge-selected">&#10003; Selected</span>' : ''}
            <span class="sw-slot-time">${formatTime(slot.time)}</span>
            <span class="sw-slot-instructor">${slot.instructor_name}</span>
          </button>
        `;
      }
      slotsHtml += `</div></div>`;
    }

    return `
      <div class="sw-step">
        <h3 class="sw-heading">Available Times</h3>
        <p class="sw-subtext">${state.instrument} lessons in ${state.city} (${state.lessonLength} min)</p>
        ${instructorFilter}
        <div class="sw-slots-container">${slotsHtml}</div>
        <div class="sw-step2-actions">
          <button id="sw-back-1" class="sw-btn sw-btn-secondary">Back</button>
          <button id="sw-next-3" class="sw-btn sw-btn-primary" ${!state.selectedSlot ? 'disabled' : ''}>Continue</button>
        </div>
      </div>
    `;
  }

  function renderStep3() {
    const slot = state.selectedSlot;
    return `
      <div class="sw-step">
        <h3 class="sw-heading">Your Information</h3>
        <div class="sw-selection-summary">
          <strong>${slot.instructor_name}</strong>, ${slot.day} at ${formatTime(slot.time)}<br>
          Your <strong>free first lesson</strong> (${state.lessonLength} min ${state.instrument})
        </div>

        ${renderLessonForField()}

        <div class="sw-field ${fieldErrorClass('name')}">
          <label class="sw-label" for="sw-name">Your Name</label>
          <input type="text" id="sw-name" class="sw-input" placeholder="First and last name" value="${state.clientName}">
          ${fieldErrorHtml('name')}
        </div>

        <div class="sw-field ${fieldErrorClass('email')}">
          <label class="sw-label" for="sw-email">Email</label>
          <input type="email" id="sw-email" class="sw-input" placeholder="your@email.com" value="${state.clientEmail}">
          ${fieldErrorHtml('email')}
        </div>

        <div class="sw-field ${fieldErrorClass('phone')}">
          <label class="sw-label" for="sw-phone">Phone</label>
          <input type="tel" id="sw-phone" class="sw-input" placeholder="(555) 123-4567" value="${state.clientPhone}">
          ${fieldErrorHtml('phone')}
        </div>

        <div class="sw-field ${fieldErrorClass('address')}">
          <label class="sw-label" for="sw-address-final">Lesson Address</label>
          <input type="text" id="sw-address-final" class="sw-input" placeholder="Full address where lessons will take place" value="${state.address}">
          ${fieldErrorHtml('address')}
        </div>

        <!-- Honeypot -->
        <div style="position:absolute;left:-9999px;" aria-hidden="true"><input type="text" id="sw-hp" name="sw-hp" tabindex="-1" autocomplete="off" aria-hidden="true"></div>

        ${renderMcmcPayment()}

        <div class="sw-step2-actions">
          <button id="sw-back-2" class="sw-btn sw-btn-secondary">Back</button>
        </div>
      </div>
    `;
  }

  function renderMcmcPayment() {
    // The first lesson is always free. There is no trial charge and no payment
    // step anywhere in this widget. The button id must stay 'sw-submit' so the
    // existing handleBooking binding (the no-payment path) picks it up.
    return `
      <div class="sw-pay-card">
        <div class="sw-pay-eyebrow">Free First Lesson</div>
        <div class="sw-pay-headline">Your first lesson is free</div>
        <div class="sw-pay-subtext">Nothing to pay today. This is a relaxed first lesson to meet your teacher, with no obligation to continue. If you keep going, it's $${MONTHLY_RATES[state.lessonLength]}/mo for your weekly ${state.lessonLength}-minute lesson, based on four lessons a month.</div>
        <button id="sw-submit" class="sw-btn sw-btn-primary" ${state.loading ? 'disabled' : ''}>
          ${state.loading ? '<span class="sw-spinner"></span> Booking...' : 'Book My Free Lesson'}
        </button>
      </div>
      <button id="sw-callback" class="sw-text-link" ${state.loading ? 'disabled' : ''}>
        Or have an instructor call you first &rarr;
      </button>
    `;
  }

  function renderStep4() {
    const c = state.confirmation;

    if (c.isLead) {
      const instrumentLabel = state.instrument === 'Other' && state.instrumentOther
        ? state.instrumentOther : state.instrument;
      return `
        <div class="sw-step sw-step-confirm">
          <div class="sw-check-icon">&#10003;</div>
          <h3 class="sw-heading">Got It!</h3>
          <p class="sw-confirm-text">${c.message}</p>
          <div class="sw-confirm-details">
            <div><strong>Instrument:</strong> ${instrumentLabel}</div>
            <div><strong>City:</strong> ${state.city || 'Not given'}</div>
            <div><strong>Email:</strong> ${state.clientEmail}</div>
          </div>
          <p class="sw-subtext">Questions? Call us at <a href="tel:7605732120">(760) 573-2120</a>.</p>
          <button id="sw-done" class="sw-btn sw-btn-primary">Close</button>
        </div>
      `;
    }

    const headline = c.isCallback ? "We'll Call You Soon" : "Your Free Lesson Is Booked";
    const text = c.isCallback
      ? "Thanks! We've got your slot reserved and will call within 24 hours to walk you through everything."
      : `${c.message} Your first lesson is free, and there is nothing to pay today. We'll confirm the details by email shortly.`;

    return `
      <div class="sw-step sw-step-confirm">
        <div class="sw-check-icon">&#10003;</div>
        <h3 class="sw-heading">${headline}</h3>
        <p class="sw-confirm-text">${text}</p>
        <div class="sw-confirm-details">
          <div><strong>Instructor:</strong> ${c.instructor_name}</div>
          <div><strong>Day:</strong> ${c.day}</div>
          <div><strong>Time:</strong> ${formatTime(c.time)}</div>
          <div><strong>Duration:</strong> ${state.lessonLength} min</div>
          <div><strong>Instrument:</strong> ${state.instrument}</div>
        </div>
        <p class="sw-subtext">Questions? Call us at <a href="tel:7605732120">(760) 573-2120</a>.</p>
        <button id="sw-done" class="sw-btn sw-btn-primary">Close</button>
      </div>
    `;
  }

  function renderStep5() {
    if (LEAD_ONLY) return renderLeadOnlyForm();

    const instrumentLabel = state.instrument === 'Other' && state.instrumentOther
      ? state.instrumentOther : state.instrument;
    const headline = state.instrument === 'Other'
      ? `Tell Us About Your ${instrumentLabel} Lessons`
      : `We'll Find You A ${instrumentLabel} Instructor`;
    const subtext = state.instrument === 'Other'
      ? `We don't have a ${instrumentLabel} instructor listed yet, but we may be able to bring one on for you. Leave your info and we'll reach out within 24 hours.`
      : `We don't have an opening for ${instrumentLabel} in ${state.city} right now. Leave your info and we'll reach out within 24 hours as we expand.`;

    return `
      <div class="sw-step">
        <h3 class="sw-heading">${headline}</h3>
        <p class="sw-subtext">${subtext}</p>

        ${renderLessonForField()}

        <div class="sw-field">
          <label class="sw-label" for="sw-name">Your Name</label>
          <input type="text" id="sw-name" class="sw-input" placeholder="First and last name" value="${state.clientName}">
        </div>

        <div class="sw-field">
          <label class="sw-label" for="sw-email">Email</label>
          <input type="email" id="sw-email" class="sw-input" placeholder="your@email.com" value="${state.clientEmail}">
        </div>

        <div class="sw-field">
          <label class="sw-label" for="sw-phone">Phone</label>
          <input type="tel" id="sw-phone" class="sw-input" placeholder="(555) 123-4567" value="${state.clientPhone}">
        </div>

        <div class="sw-field">
          <label class="sw-label" for="sw-notes">Anything else we should know? <span class="sw-optional">(optional)</span></label>
          <input type="text" id="sw-notes" class="sw-input" placeholder="e.g., student age, experience level, preferred days" value="${state.notes}">
        </div>

        <div style="position:absolute;left:-9999px;" aria-hidden="true"><input type="text" id="sw-hp" name="sw-hp" tabindex="-1" autocomplete="off" aria-hidden="true"></div>

        <div class="sw-step2-actions">
          <button id="sw-back-1" class="sw-btn sw-btn-secondary">Back</button>
          <button id="sw-submit-lead" class="sw-btn sw-btn-primary" ${state.loading ? 'disabled' : ''}>
            ${state.loading ? '<span class="sw-spinner"></span> Sending...' : 'Submit'}
          </button>
        </div>
      </div>
    `;
  }

  // The three contact fields, in the order this page asked for.
  //
  // Same markup and the same ids either way, so validation, stashUserData() and
  // the enhanced-conversions payload are all order-independent and untouched.
  function contactFields() {
    const name = `
        <div class="sw-field ${fieldErrorClass('name')}">
          <label class="sw-label" for="sw-name">Your Name</label>
          <input type="text" id="sw-name" name="name" autocomplete="name" class="sw-input" placeholder="First and last name" value="${state.clientName}">
          ${fieldErrorHtml('name')}
        </div>`;
    const email = `
        <div class="sw-field ${fieldErrorClass('email')}">
          <label class="sw-label" for="sw-email">Email</label>
          <input type="email" id="sw-email" name="email" autocomplete="email" class="sw-input" placeholder="your@email.com" value="${state.clientEmail}">
          ${fieldErrorHtml('email')}
        </div>`;
    const phone = `
        <div class="sw-field ${fieldErrorClass('phone')}">
          <label class="sw-label" for="sw-phone">Phone</label>
          <input type="tel" id="sw-phone" name="phone" autocomplete="tel" class="sw-input" placeholder="(555) 123-4567" value="${state.clientPhone}">
          ${fieldErrorHtml('phone')}
        </div>`;
    return PHONE_FIRST ? phone + name + email : name + email + phone;
  }

  // ONE screen, three fields.
  //
  // This was two screens and eight required fields. On the paid Orange County
  // landing page that produced 21 clicks and ZERO submissions in eight days, while
  // the phone link beside it was tapped nine times. The form was not competing with
  // the phone, it was losing to it.
  //
  // Name, email and phone are what it takes to reach somebody. Who the lesson is
  // for, the student age, the city and how soon they want to start are all
  // questions that get asked on the callback anyway, and gating a stranger's first
  // contact on them bought nothing.
  //
  // Email stays required because the lead drip is email-based, so dropping it would
  // leave a phone number and no follow-up path. Those same three fields are exactly
  // what stashUserData() hands to Google for enhanced conversions, so a shorter form
  // than this would quietly degrade Ads matching as well.
  function renderLeadOnlyForm() {
    // Only ask the instrument when the PAGE already knows it. Paid landing pages set
    // MCMC_PREFILL_INSTRUMENT and a ?book= value overrides that; pages that set
    // neither still have to ask, so this cannot become a blind default.
    //
    // Keyed off requestedInstrument() — the page URL and the page global — and NOT
    // off state.instrument. The select's change handler writes state.instrument and
    // then re-renders, so reading the mutable field here made the question delete
    // itself the instant a visitor answered it: no confirmation of the choice, no way
    // to change it, and a mis-picked "Other" was unrecoverable without a reload.
    const needsInstrument = !requestedInstrument();
    const instrumentOptions = INSTRUMENTS.map(i =>
      `<option value="${i}" ${state.instrument === i ? 'selected' : ''}>${i}</option>`
    ).join('');

    return `
      <div class="sw-step">
        ${leadHeader()}

        ${needsInstrument ? `
          <div class="sw-field ${fieldErrorClass('instrument')}">
            <label class="sw-label" for="sw-instrument">Instrument of Interest</label>
            <select id="sw-instrument" class="sw-select">
              <option value="">Choose an instrument...</option>
              ${instrumentOptions}
            </select>
            ${fieldErrorHtml('instrument')}
          </div>
        ` : ''}

        ${state.instrument === 'Other' ? `
          <div class="sw-field ${fieldErrorClass('instrumentOther')}">
            <label class="sw-label" for="sw-instrument-other">Which instrument?</label>
            <input type="text" id="sw-instrument-other" class="sw-input" placeholder="e.g., Violin, Saxophone" value="${state.instrumentOther}">
            ${fieldErrorHtml('instrumentOther')}
          </div>
        ` : ''}

        ${contactFields()}

        <div style="position:absolute;left:-9999px;" aria-hidden="true"><input type="text" id="sw-hp" name="sw-hp" tabindex="-1" autocomplete="off" aria-hidden="true"></div>

        ${renderMmDeposit()}
      </div>
    `;
  }

  function leadHeader() {
    // state.city when a single-city page set it, else the region label, else nothing.
    // Never the phrase "your area".
    const area = state.city || AREA_LABEL;
    const headline = area
      ? `Book Your Free First Lesson in ${area}`
      : 'Book Your Free First Lesson';
    const where = area ? ` in ${area}` : '';
    // "at your own piano" is only true on the piano pages. It was hardcoded here and
    // so rendered on the guitar, bass, drums, voice and ukulele pages too. Every other
    // instrument gets the phrasing that is true everywhere, including when the visitor
    // has not told us the instrument yet: the lesson comes to them.
    const place = state.instrument === 'Piano' ? 'at your own piano' : 'in your own home';
    const subtext = `Your first lesson is free, taught ${place}${where}, with no obligation to continue. Tell us where to reach you and we will confirm your instructor within 24 hours.`;
    return `
        <h3 class="sw-heading">${headline}</h3>
        <p class="sw-subtext">${subtext}</p>`;
  }

  // No deposit and no payment at booking. The first lesson is free, so this is a
  // plain submission. The deposit path was removed with the paid trial.
  function renderMmDeposit() {
    return `
      <button id="sw-submit-lead" class="sw-btn sw-btn-primary" ${state.loading ? 'disabled' : ''}>
        ${state.loading ? '<span class="sw-spinner"></span> Sending...' : 'Book My Free First Lesson'}
      </button>
      <p class="sw-fineprint">We'll get back to you within 24 hours. Your info stays private.</p>
    `;
  }

  // ─── Events ────────────────────────────────────────────────────────────────
  function bindEvents() {
    // Step 1
    const findBtn = document.getElementById('sw-find');
    if (findBtn) {
      findBtn.addEventListener('click', handleFindSlots);
    }

    const instrumentSel = document.getElementById('sw-instrument');
    if (instrumentSel) instrumentSel.addEventListener('change', e => {
      state.instrument = e.target.value;
      clearFieldError('instrument');
      // Re-render so "Other" text input appears/disappears
      render();
    });

    const instrumentOtherInput = document.getElementById('sw-instrument-other');
    if (instrumentOtherInput) instrumentOtherInput.addEventListener('input', e => {
      state.instrumentOther = e.target.value;
      clearFieldError('instrumentOther');
    });

    const citySel = document.getElementById('sw-city');
    if (citySel) citySel.addEventListener('change', e => { state.city = e.target.value; clearFieldError('city'); });

    const lengthSel = document.getElementById('sw-length');
    if (lengthSel) lengthSel.addEventListener('change', e => { state.lessonLength = parseInt(e.target.value); });

    const addrInput = document.getElementById('sw-address');
    if (addrInput) addrInput.addEventListener('input', e => { state.address = e.target.value; });

    document.querySelectorAll('.sw-pill[data-day]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = parseInt(btn.dataset.day);
        const i = state.preferredDays.indexOf(v);
        if (i >= 0) state.preferredDays.splice(i, 1); else state.preferredDays.push(v);
        render();
      });
    });

    document.querySelectorAll('.sw-pill[data-time]').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.time;
        const i = state.preferredTimes.indexOf(k);
        if (i >= 0) state.preferredTimes.splice(i, 1); else state.preferredTimes.push(k);
        render();
      });
    });

    document.querySelectorAll('.sw-pill[data-lessonfor]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.lessonFor = btn.dataset.lessonfor;
        clearFieldError('lessonFor');
        render();
      });
    });

    // Step 2
    document.querySelectorAll('.sw-slot').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedSlot = JSON.parse(btn.dataset.slot);
        render();
      });
    });

    const filterSel = document.getElementById('sw-filter-instructor');
    if (filterSel) filterSel.addEventListener('change', e => {
      state.filterInstructor = e.target.value;
      render();
    });

    const next3Btn = document.getElementById('sw-next-3');
    if (next3Btn) next3Btn.addEventListener('click', () => { state.step = 3; render(); });

    // Back buttons
    const back1 = document.getElementById('sw-back-1');
    if (back1) back1.addEventListener('click', () => { state.step = 1; state.error = ''; render(); });

    const back2 = document.getElementById('sw-back-2');
    if (back2) back2.addEventListener('click', () => { state.step = 2; state.error = ''; render(); });

    // Step 3
    const nameInput = document.getElementById('sw-name');
    if (nameInput) nameInput.addEventListener('input', e => { state.clientName = e.target.value; clearFieldError('name'); });

    const emailInput = document.getElementById('sw-email');
    if (emailInput) emailInput.addEventListener('input', e => { state.clientEmail = e.target.value; clearFieldError('email'); });

    const phoneInput = document.getElementById('sw-phone');
    if (phoneInput) phoneInput.addEventListener('input', e => { state.clientPhone = e.target.value; clearFieldError('phone'); });

    const addrFinal = document.getElementById('sw-address-final');
    if (addrFinal) addrFinal.addEventListener('input', e => { state.address = e.target.value; clearFieldError('address'); });

    const submitBtn = document.getElementById('sw-submit');
    if (submitBtn) submitBtn.addEventListener('click', handleBooking);

    // Step 5 (lead capture)
    const notesInput = document.getElementById('sw-notes');
    if (notesInput) notesInput.addEventListener('input', e => { state.notes = e.target.value; });

    const submitLeadBtn = document.getElementById('sw-submit-lead');
    if (submitLeadBtn) submitLeadBtn.addEventListener('click', handleLeadSubmit);

    // Callback link (MCMC step 3 alternative to paying)
    const callbackBtn = document.getElementById('sw-callback');
    if (callbackBtn) callbackBtn.addEventListener('click', handleCallbackRequest);

    // Step 4
    const doneBtn = document.getElementById('sw-done');
    if (doneBtn) doneBtn.addEventListener('click', () => { closeModalDirect(); resetState(); });
  }

  async function handleFindSlots() {
    clearAllErrors();
    let bad = false;
    if (!state.instrument) { setFieldError('instrument', 'Please select an instrument.'); bad = true; }
    if (state.instrument === 'Other' && !state.instrumentOther.trim()) {
      setFieldError('instrumentOther', 'Please tell us which instrument.'); bad = true;
    }
    if (!state.city) { setFieldError('city', 'Please select your city.'); bad = true; }
    if (bad) { render(); return; }

    // "Other" instruments skip availability lookup — go straight to lead capture
    if (state.instrument === 'Other') {
      state.mode = 'lead';
      state.step = 5;
      state.error = '';
      render();
      return;
    }

    state.loading = true;
    state.error = '';
    render();

    try {
      const preferred_times = TIME_BUCKETS
        .filter(t => state.preferredTimes.includes(t.key))
        .map(t => t.range);
      const result = await fetchAvailability({
        instrument: state.instrument,
        city: state.city,
        lesson_length: state.lessonLength,
        address: state.address || undefined,
        preferred_days: state.preferredDays.length ? state.preferredDays : undefined,
        preferred_times: preferred_times.length ? preferred_times : undefined,
      });
      const hasSlots = result?.recommended || (result?.alternatives?.length > 0);
      if (!hasSlots) {
        // No instructor available — capture as lead instead of dead-end
        state.mode = 'lead';
        state.step = 5;
        state.slots = result;
      } else {
        state.mode = 'booking';
        state.slots = result;
        state.selectedSlot = null;
        state.filterInstructor = '';
        state.step = 2;
      }
    } catch (e) {
      state.error = 'Could not load availability. Please try again or call us at (760) 573-2120.';
    }

    state.loading = false;
    render();
  }

  // Google requires E.164 for enhanced-conversion phone matching. These are US
  // numbers typed by hand, so anything that is not a plain 10-digit (or leading-1
  // 11-digit) number is dropped rather than guessed at.
  function normalizeE164(raw) {
    const d = (raw || '').replace(/\D/g, '');
    if (d.length === 10) return '+1' + d;
    if (d.length === 11 && d[0] === '1') return '+' + d;
    return undefined;
  }

  // Key is read and deleted by thank-you.html. Keep the two in sync.
  const USER_DATA_KEY = 'mm_ec_user_data';

  // Hand enhanced-conversion identifiers to thank-you.html, where the Ads
  // conversion actually fires. Everything here is best-effort: sessionStorage
  // throws in Safari private mode and under some cookie blockers, and a lead is
  // worth more than its measurement, so a failure here must never surface to
  // the visitor or interrupt the redirect.
  function stashUserData() {
    try {
      const nameParts = state.clientName.trim().split(/\s+/).filter(Boolean);
      const email = state.clientEmail.trim().toLowerCase();
      const phone = normalizeE164(state.clientPhone);
      const address = {};
      if (nameParts[0]) address.first_name = nameParts[0];
      if (nameParts.length > 1) address.last_name = nameParts[nameParts.length - 1];

      const ud = {};
      if (email) ud.email = email;
      if (phone) ud.phone_number = phone;
      if (Object.keys(address).length) ud.address = address;

      // Nothing usable means nothing to match on. Clear any earlier submission's
      // key rather than leaving it to be attributed to this conversion.
      if (!Object.keys(ud).length) {
        window.sessionStorage.removeItem(USER_DATA_KEY);
        return;
      }
      window.sessionStorage.setItem(USER_DATA_KEY, JSON.stringify(ud));
    } catch (e) {
      // Storage unavailable. The conversion still fires, just unenhanced.
    }
  }

  async function handleLeadSubmit() {
    clearAllErrors();
    let bad = false;
    if (!state.clientName.trim()) { setFieldError('name', 'Please enter your name.'); bad = true; }
    if (!state.clientEmail.trim() || !state.clientEmail.includes('@')) {
      setFieldError('email', 'Please enter a valid email.'); bad = true;
    }
    // Validate ONLY what the form still asks for. lessonFor, studentAge, city and
    // startTiming used to be required here; they are no longer collected on a
    // lead-only page, so requiring them would refuse every submission with an error
    // pointing at a field the visitor cannot see. They are still SENT below whenever
    // something upstream already put them in state.
    if (!state.lessonFor && !LEAD_ONLY) {
      setFieldError('lessonFor', 'Please tell us who the lesson is for.'); bad = true;
    }
    if (LEAD_ONLY) {
      if (!state.clientPhone.trim()) { setFieldError('phone', 'Please enter your phone number.'); bad = true; }
      if (!state.instrument) { setFieldError('instrument', 'Please select an instrument.'); bad = true; }
      if (state.instrument === 'Other' && !state.instrumentOther.trim()) {
        setFieldError('instrumentOther', 'Please tell us which instrument.'); bad = true;
      }
    }
    if (bad) { render(); return; }

    const hp = document.getElementById('sw-hp');
    if (hp && hp.value) {
      // A bare `return` here meant the button did nothing at all: no error, no
      // spinner, no request. A bot does not care, but a human whose password
      // manager or accessibility tool filled the off-screen field just clicks
      // and watches the page sit there, with no way to work out why. Bots are
      // still blocked; humans now get a way out.
      state.loading = false;
      state.error = 'Something went wrong sending your details. Please call us at (760) 573-2120 and we will get you booked.';
      render();
      return;
    }

    state.loading = true;
    state.error = '';
    render();

    try {
      const result = await submitLead({
        client_name: state.clientName.trim(),
        email: state.clientEmail.trim(),
        phone: state.clientPhone.trim(),
        instrument: state.instrument,
        instrument_other: state.instrumentOther.trim() || undefined,
        city: state.city.trim() || undefined,
        student_age: state.studentAge.trim() || undefined,
        lesson_for: state.lessonFor || undefined,
        start_timing: state.startTiming || undefined,
        notes: state.notes.trim() || undefined,
        brand_source: BRAND_SOURCE,
        honeypot: '',
      });

      // Enhanced conversions. The Ads conversion fires on thank-you.html, one
      // full top-level navigation from here, and gtag state does NOT survive a
      // page load — an earlier gtag('set','user_data',...) on this page reached
      // nothing. Hand the identifiers over through sessionStorage instead: same
      // origin (the apex 308s to www), and unlike the redirect query string it
      // keeps PII out of URLs, referrers and server logs. thank-you.html reads
      // this key, sets user_data, fires the conversion, then deletes it.
      stashUserData();

      // Fire conversion event regardless of redirect path so it counts even if
      // the redirect itself fails for some reason.
      if (typeof gtag === 'function') {
        gtag('event', 'form_submission', {
          event_category: 'lead',
          event_label: `${state.instrument === 'Other' ? state.instrumentOther : state.instrument} - ${state.city}`,
        });
      }

      // Conversion redirect (Google Ads conversion tracking lives on the
      // thank-you page). If set, send the user there as a top-level navigation.
      if (THANK_YOU_REDIRECT) {
        window.location.href = buildRedirectUrl({
          type: 'lead',
          instrument: state.instrument === 'Other' ? state.instrumentOther : state.instrument,
          city: state.city,
        });
        return;
      }

      state.confirmation = { ...result, isLead: true };
      state.step = 4;
    } catch (e) {
      state.error = e.message || 'Submission failed. Please try again.';
    }

    state.loading = false;
    render();
  }

  async function handleBooking() {
    clearAllErrors();
    let bad = false;
    if (!state.clientName.trim()) { setFieldError('name', 'Please enter your name.'); bad = true; }
    if (!state.clientEmail.trim() || !state.clientEmail.includes('@')) { setFieldError('email', 'Please enter a valid email.'); bad = true; }
    if (!state.address.trim()) { setFieldError('address', 'Please enter your lesson address.'); bad = true; }
    if (!state.lessonFor) { setFieldError('lessonFor', 'Please tell us who the lesson is for.'); bad = true; }
    if (bad) { render(); return; }

    // Honeypot check
    const hp = document.getElementById('sw-hp');
    if (hp && hp.value) {
      // A bare `return` here meant the button did nothing at all: no error, no
      // spinner, no request. A bot does not care, but a human whose password
      // manager or accessibility tool filled the off-screen field just clicks
      // and watches the page sit there, with no way to work out why. Bots are
      // still blocked; humans now get a way out.
      state.loading = false;
      state.error = 'Something went wrong sending your details. Please call us at (760) 573-2120 and we will get you booked.';
      render();
      return;
    }

    state.loading = true;
    state.error = '';
    render();

    try {
      const result = await bookLesson({
        client_name: state.clientName.trim(),
        email: state.clientEmail.trim(),
        phone: state.clientPhone.trim(),
        instrument: state.instrument,
        address: state.address.trim(),
        city: state.city,
        instructor_id: state.selectedSlot.instructor_id,
        day_of_week: state.selectedSlot.day_of_week,
        start_time: state.selectedSlot.time,
        lesson_date: state.selectedSlot.date,
        lesson_length: state.lessonLength,
        lesson_for: state.lessonFor || undefined,
        honeypot: '',
      });

      // Fire GA4 conversion event before any redirect
      if (typeof gtag === 'function') {
        gtag('event', 'form_submission', {
          event_category: 'booking',
          event_label: `${state.instrument} - ${state.selectedSlot.instructor_name}`,
        });
      }

      if (THANK_YOU_REDIRECT) {
        // Without `type`, thank-you.html's gate returns before firing anything and
        // the conversion for a completed booking is silently dropped. It also needs
        // stashUserData() for the enhanced-conversion identifiers, exactly as the
        // lead path does — gtag 'set' state does not survive a top-level navigation.
        stashUserData();
        window.location.href = buildRedirectUrl({
          type: 'booking',
          instrument: state.instrument,
          city: state.city,
        });
        return;
      }

      state.confirmation = result;
      state.step = 4;
    } catch (e) {
      state.error = e.message || 'Booking failed. Please try again.';
    }

    state.loading = false;
    render();
  }

  async function handleCallbackRequest() {
    state.loading = true; state.error = ''; render();
    try {
      // Collect contact info exactly like a normal booking, but no slot is held
      if (!state.clientName.trim()) throw new Error('Please enter your name.');
      if (!state.clientEmail.trim() || !state.clientEmail.includes('@')) throw new Error('Please enter a valid email.');
      if (!state.address.trim()) throw new Error('Please enter your lesson address.');
      if (!state.lessonFor) throw new Error('Please tell us who the lesson is for.');

      const result = await bookLesson({
        client_name: state.clientName.trim(),
        email: state.clientEmail.trim(),
        phone: state.clientPhone.trim(),
        instrument: state.instrument,
        address: state.address.trim(),
        city: state.city,
        instructor_id: state.selectedSlot.instructor_id,
        day_of_week: state.selectedSlot.day_of_week,
        start_time: state.selectedSlot.time,
        lesson_date: state.selectedSlot.date,
        lesson_length: state.lessonLength,
        lesson_for: state.lessonFor || undefined,
        callback_requested: true,
        honeypot: '',
      });
      if (typeof gtag === 'function') {
        gtag('event', 'form_submission', { event_category: 'callback_request', event_label: state.instrument });
      }
      if (THANK_YOU_REDIRECT) {
        window.location.href = buildRedirectUrl({
          type: 'callback',
          instructor: result.instructor_name,
          day: result.day,
          time: result.time,
          duration: state.lessonLength,
          instrument: state.instrument,
        });
        return;
      }
      state.confirmation = { ...result, isCallback: true }; state.step = 4;
    } catch (e) {
      state.error = e.message || 'Could not submit callback request.';
    }
    state.loading = false; render();
  }

  function resetState() {
    const cachedCities = state.cities;
    state = freshState();
    state.cities = cachedCities;
    if (typeof window.MCMC_PREFILL_CITY === 'string' && window.MCMC_PREFILL_CITY) {
      if (LEAD_ONLY || cachedCities.includes(window.MCMC_PREFILL_CITY)) {
        state.city = window.MCMC_PREFILL_CITY;
      }
    }
    // Re-applied on every modal open, so closing and reopening a ?book=piano
    // page still lands on piano. Needs no reconciliation against a fetched list
    // the way city does: requestedInstrument() is itself the allowlist.
    state.instrument = requestedInstrument();
    if (LEAD_ONLY) {
      state.step = 5;
      state.mode = 'lead_only';
    }
  }

  // ─── Styles ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('sw-styles')) return;
    const style = document.createElement('style');
    style.id = 'sw-styles';
    style.textContent = `
      #scheduling-widget {
        font-family: 'Questrial', sans-serif;
        color: #0d0d0d;
        padding: 32px 28px;
      }
      .sw-step { max-width: 480px; margin: 0 auto; }
      .sw-heading {
        font-family: 'Montserrat', sans-serif;
        font-weight: 800;
        font-size: 22px;
        letter-spacing: -0.02em;
        margin: 0 0 8px;
      }
      .sw-subtext { color: #666; font-size: 14px; margin: 0 0 24px; line-height: 1.5; }
      .sw-subtext a { color: #726edd; }
      .sw-field { margin-bottom: 16px; }
      .sw-label {
        display: block;
        font-family: 'Montserrat', sans-serif;
        font-weight: 600;
        font-size: 13px;
        margin-bottom: 6px;
        color: #333;
      }
      .sw-optional { font-weight: 400; color: #999; font-size: 12px; }
      .sw-select, .sw-input {
        width: 100%;
        padding: 10px 14px;
        border: 1.5px solid rgba(0,0,0,0.15);
        border-radius: 10px;
        font-size: 15px;
        font-family: 'Questrial', sans-serif;
        background: #fff;
        transition: border-color 0.2s;
        box-sizing: border-box;
      }
      .sw-select:focus, .sw-input:focus {
        outline: none;
        border-color: #726edd;
        box-shadow: 0 0 0 3px rgba(114,110,221,0.12);
      }
      .sw-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 28px;
        border-radius: 9999px;
        font-family: 'Montserrat', sans-serif;
        font-weight: 700;
        font-size: 14px;
        border: none;
        cursor: pointer;
        transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
      }
      .sw-btn:hover:not(:disabled) { transform: translateY(-1px); }
      .sw-btn:active:not(:disabled) { transform: translateY(0); }
      .sw-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .sw-btn-primary {
        background: #5f5bc8;
        color: #fff;
        box-shadow: 0 4px 16px rgba(114,110,221,0.3);
        width: 100%;
        margin-top: 8px;
      }
      .sw-btn-primary:hover:not(:disabled) {
        box-shadow: 0 6px 24px rgba(114,110,221,0.4);
      }
      .sw-btn-secondary {
        background: #f9f8ff;
        color: #726edd;
        border: 1.5px solid rgba(114,110,221,0.3);
      }
      .sw-btn-ghost {
        background: transparent;
        color: #5f5bc8;
        width: 100%;
        margin-top: 8px;
        box-shadow: none;
      }
      .sw-btn-ghost:hover:not(:disabled) { background: #f4f3ff; }
      textarea.sw-input { resize: vertical; min-height: 88px; font-family: 'Questrial', sans-serif; }
      .sw-fineprint { font-family: 'Questrial', sans-serif; font-size: 12px; color: #5f5f5f; text-align: center; margin: 14px 0 0; }

      /* Trial banner (top of step 1) */
      .sw-trial-banner {
        background: linear-gradient(135deg, #726edd 0%, #5f5bc8 100%);
        color: #fff;
        border-radius: 14px;
        padding: 14px 18px;
        margin: -8px -4px 20px;
        text-align: center;
        box-shadow: 0 4px 16px rgba(114,110,221,0.28);
      }
      .sw-trial-banner-eyebrow {
        font-family: 'Montserrat', sans-serif;
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(255,255,255,0.85);
        margin-bottom: 4px;
      }
      .sw-trial-banner-headline {
        font-family: 'Montserrat', sans-serif;
        font-weight: 800;
        font-size: 17px;
        letter-spacing: -0.01em;
      }

      /* Payment card */
      .sw-pay-card {
        background: linear-gradient(135deg, #f9f8ff 0%, #ede9ff 100%);
        border: 1.5px solid rgba(114,110,221,0.25);
        border-radius: 14px;
        padding: 18px;
        margin: 12px 0 8px;
      }
      .sw-pay-eyebrow {
        font-family: 'Montserrat', sans-serif;
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #fc4e1a;
        margin-bottom: 6px;
      }
      .sw-pay-headline {
        font-family: 'Montserrat', sans-serif;
        font-weight: 800;
        font-size: 18px;
        color: #0d0d0d;
        margin-bottom: 8px;
        letter-spacing: -0.01em;
      }
      .sw-pay-price-breakdown {
        font-family: 'Questrial', sans-serif;
        font-size: 14px;
        color: #333;
        margin-bottom: 10px;
      }
      .sw-pay-price-breakdown s { color: #999; }
      .sw-pay-subtext {
        font-family: 'Questrial', sans-serif;
        font-size: 12px;
        color: #666;
        margin-bottom: 14px;
        line-height: 1.5;
      }
      .sw-text-link {
        background: transparent;
        border: none;
        color: #726edd;
        font-family: 'Montserrat', sans-serif;
        font-weight: 600;
        font-size: 13px;
        text-align: center;
        width: 100%;
        margin-top: 10px;
        padding: 10px;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      .sw-text-link:hover { color: #5f5bc8; }
      .sw-text-link:focus-visible { outline: 2px solid rgba(114,110,221,0.4); outline-offset: 2px; border-radius: 6px; }
      .sw-pill-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .sw-pill {
        font-family: 'Montserrat', sans-serif;
        font-weight: 600;
        font-size: 13px;
        padding: 8px 14px;
        border-radius: 9999px;
        border: 1.5px solid rgba(0,0,0,0.12);
        background: #fff;
        color: #333;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s;
      }
      .sw-pill:hover { border-color: #726edd; }
      .sw-pill:active { transform: scale(0.97); }
      .sw-pill-on {
        background: #726edd;
        border-color: #726edd;
        color: #fff;
      }
      .sw-bucket-hint {
        font-size: 11px;
        color: #999;
        margin-top: 6px;
        font-family: 'Questrial', sans-serif;
      }
      .sw-error {
        background: #fff0f0;
        color: #c0392b;
        padding: 10px 16px;
        border-radius: 10px;
        font-size: 14px;
        margin-bottom: 16px;
        border: 1px solid rgba(192,57,43,0.15);
      }
      /* Inline field validation errors */
      .sw-field-error .sw-input,
      .sw-field-error .sw-select {
        border-color: #c0392b;
        box-shadow: 0 0 0 3px rgba(192,57,43,0.12);
      }
      .sw-field-error-msg {
        color: #c0392b;
        font-family: 'Questrial', sans-serif;
        font-size: 12px;
        margin-top: 5px;
        font-weight: 600;
      }
      .sw-spinner {
        width: 16px; height: 16px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: sw-spin 0.6s linear infinite;
      }
      @keyframes sw-spin { to { transform: rotate(360deg); } }

      /* Step 2: Slots */
      .sw-slots-container { margin: 16px 0; max-height: 360px; overflow-y: auto; }
      .sw-day-group { margin-bottom: 16px; }
      .sw-day-label {
        font-family: 'Montserrat', sans-serif;
        font-weight: 700;
        font-size: 13px;
        color: #726edd;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 8px;
      }
      .sw-slots-row { display: flex; flex-wrap: wrap; gap: 8px; }
      .sw-slot {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 10px 16px;
        border: 1.5px solid rgba(0,0,0,0.1);
        border-radius: 12px;
        background: #fff;
        cursor: pointer;
        transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
        min-width: 100px;
      }
      .sw-slot:hover {
        border-color: #726edd;
        box-shadow: 0 2px 12px rgba(114,110,221,0.15);
        transform: translateY(-1px);
      }
      .sw-slot-selected {
        border-color: #726edd;
        border-width: 2.5px;
        background: linear-gradient(135deg, #ede9ff 0%, #d8d2ff 100%);
        box-shadow: 0 4px 20px rgba(114,110,221,0.35);
        transform: translateY(-2px);
      }
      .sw-slot-selected .sw-slot-time { color: #5f5bc8; }
      .sw-slot-recommended {
        border-color: #726edd;
        background: linear-gradient(135deg, #f9f8ff 0%, #ede9ff 100%);
      }
      .sw-badge {
        position: absolute;
        top: -8px;
        right: -4px;
        background: #726edd;
        color: #fff;
        font-family: 'Montserrat', sans-serif;
        font-weight: 700;
        font-size: 9px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: 2px 8px;
        border-radius: 9999px;
      }
      .sw-badge-selected {
        background: #fc4e1a;
        right: auto; left: -4px;
      }
      .sw-slot-time {
        font-family: 'Montserrat', sans-serif;
        font-weight: 700;
        font-size: 14px;
      }
      .sw-slot-instructor { font-size: 12px; color: #666; margin-top: 2px; }
      .sw-step2-actions { display: flex; gap: 12px; margin-top: 16px; }
      .sw-step2-actions .sw-btn-primary { flex: 1; }

      /* Step 3: Contact */
      .sw-selection-summary {
        background: #f9f8ff;
        border: 1px solid rgba(114,110,221,0.2);
        border-radius: 12px;
        padding: 12px 16px;
        font-size: 14px;
        margin-bottom: 20px;
      }

      /* Step 4: Confirmation */
      .sw-step-confirm { text-align: center; }
      .sw-check-icon {
        width: 56px; height: 56px;
        background: #726edd;
        color: #fff;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        margin: 0 auto 16px;
      }
      .sw-confirm-text { font-size: 15px; color: #333; margin-bottom: 16px; }
      .sw-confirm-details {
        background: #f9f8ff;
        border-radius: 12px;
        padding: 16px;
        text-align: left;
        font-size: 14px;
        margin-bottom: 20px;
        line-height: 1.8;
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    injectStyles();

    // Mode detection — three possibilities:
    //   1. Inline page (city pages): an explicit <div id="scheduling-widget"> already exists
    //   2. Modal page (index.html, instructors.html): #booking-overlay .modal-card has a JotForm iframe
    //   3. Neither — widget can't render
    let inlineMode = !!document.getElementById('scheduling-widget');

    if (!inlineMode) {
      const modalCard = document.querySelector('#booking-overlay .modal-card');
      if (modalCard) {
        const iframe = modalCard.querySelector('iframe');
        if (iframe) iframe.remove();
        if (!document.getElementById('scheduling-widget')) {
          const div = document.createElement('div');
          div.id = 'scheduling-widget';
          modalCard.appendChild(div);
        }
      }
    }

    // Mode and the pre-fills come from page globals and the URL alone, so they
    // are settled before any network call. requestedInstrument() only ever
    // returns a member of INSTRUMENTS, so unlike city it needs no reconciling
    // against a fetched list.
    state.instrument = requestedInstrument();
    if (LEAD_ONLY) {
      // In lead-only mode the multi-step booking flow doesn't apply.
      // Open straight to the lead form (step 5).
      state.step = 5;
      state.mode = 'lead_only';
      if (typeof window.MCMC_PREFILL_CITY === 'string' && window.MCMC_PREFILL_CITY) {
        state.city = window.MCMC_PREFILL_CITY;
      }
    }

    if (!inlineMode) {
      // Modal mode — wrap openModal so we render on each open. This has to be
      // installed before any await: the wrapper is the only thing that renders
      // into the modal, so while init was suspended on a network call a click
      // reached the unwrapped openModal and opened an empty card.
      const origOpenModal = window.openModal;
      window.openModal = function() {
        origOpenModal();
        resetState();
        render();
      };

      // Handle the lazy-load race: if the modal is already open when the widget
      // finishes loading (the visitor clicked before the script arrived), the
      // wrapper above will never fire for that click, so render into the open
      // card now. Without this a lazily loaded widget shows an empty modal until
      // the visitor closes and reopens it. Mirrors the mtncitymusic copy.
      const overlay = document.getElementById('booking-overlay');
      if (overlay && overlay.classList.contains('open')) {
        resetState();
        render();
      }
    }

    if (inlineMode) {
      // Render BEFORE any network call. These containers sit on paid landing
      // pages, and a cold or unreachable backend previously left the form area
      // blank with nothing but a console warning. Nothing the lead form needs
      // comes from the network, so it paints first and enriches after.
      render();
      // These pages have no modal, so a booking link means the form itself.
      if (bookParamPresent()) scrollToInlineForm();
    }

    // Load cities on init (skip in lead-only mode — that flow does not ask for a city)
    if (!LEAD_ONLY) {
      try {
        state.cities = await fetchCities();
      } catch (e) {
        console.warn('Could not pre-load cities:', e);
      }
      // Apply city pre-fill; in MCMC mode this must match the cities dropdown.
      if (typeof window.MCMC_PREFILL_CITY === 'string' && window.MCMC_PREFILL_CITY
          && state.cities.includes(window.MCMC_PREFILL_CITY)) {
        state.city = window.MCMC_PREFILL_CITY;
      }
      // Re-render so the freshly loaded cities appear.
      if (inlineMode) render();
    }
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
