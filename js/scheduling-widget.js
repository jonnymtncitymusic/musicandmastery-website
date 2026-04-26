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

  // Lead-only mode skips the availability search entirely and shows a single
  // contact form. Auto-on when brand source isn't MCMC (since other brands
  // don't have instructor availability data wired in).
  const LEAD_ONLY = window.MCMC_LEAD_ONLY || (BRAND_SOURCE !== 'mcmc');

  const INSTRUMENTS = ['Guitar', 'Piano', 'Voice', 'Bass', 'Ukulele', 'Drums', 'Music Production', 'Other'];
  // Lesson length labels show TRIAL pricing — 3 lessons at 50% off the
  // standard per-lesson rate ($40/$60/$75). Total trial price is what the
  // client actually pays today via PayPal.
  const LESSON_LENGTHS = [
    { value: 30, label: '30 min — $60 trial (3 lessons, 50% off)' },
    { value: 45, label: '45 min — $90 trial (3 lessons, 50% off)' },
    { value: 60, label: '60 min — $112.50 trial (3 lessons, 50% off)' },
  ];

  // ─── State ─────────────────────────────────────────────────────────────────
  function freshState() {
    return {
      step: 1,
      mode: 'booking',  // 'booking' or 'lead' (no-match flow)
      instrument: '',
      instrumentOther: '',  // free-text when instrument === 'Other'
      city: '',
      address: '',
      lessonLength: 30,
      preferredDays: [],     // array of day-of-week ints (0=Mon..6=Sun)
      preferredTimes: [],    // array of strings: 'morning' | 'afternoon' | 'evening'
      cities: [],
      config: null,           // {paypal_client_id, mcmc_prices, mm_deposit, paypal_env}
      slots: null,
      selectedSlot: null,
      filterInstructor: '',
      clientName: '',
      clientEmail: '',
      clientPhone: '',
      studentAge: '',
      startTiming: '',  // 'asap' | 'within_month' | 'exploring'
      notes: '',
      loading: false,
      error: '',
      confirmation: null,
    };
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
  async function fetchConfig() {
    const res = await fetch(`${API_BASE}/api/scheduling/config`);
    if (!res.ok) throw new Error('Could not load config');
    return res.json();
  }

  // PayPal SDK loader — only loads once per page
  let _paypalSdkPromise = null;
  function loadPaypalSdk(clientId) {
    if (_paypalSdkPromise) return _paypalSdkPromise;
    _paypalSdkPromise = new Promise((resolve, reject) => {
      if (window.paypal) return resolve(window.paypal);
      const s = document.createElement('script');
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
      s.async = true;
      s.onload = () => resolve(window.paypal);
      s.onerror = () => reject(new Error('PayPal SDK failed to load'));
      document.head.appendChild(s);
    });
    return _paypalSdkPromise;
  }

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

  // ─── Render ────────────────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('scheduling-widget');
    if (!container) return;

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
            <div class="sw-trial-banner-eyebrow">Trial Special</div>
            <div class="sw-trial-banner-headline">Your first 3 lessons — 50% off</div>
          </div>
        `}
        <h3 class="sw-heading">Find Your Perfect Lesson</h3>
        <p class="sw-subtext">Tell us what you're looking for and we'll match you with the best instructor.</p>

        <div class="sw-field">
          <label class="sw-label">Instrument</label>
          <select id="sw-instrument" class="sw-select">
            <option value="">Choose an instrument...</option>
            ${instrumentOptions}
          </select>
        </div>

        ${state.instrument === 'Other' ? `
          <div class="sw-field">
            <label class="sw-label">Which instrument?</label>
            <input type="text" id="sw-instrument-other" class="sw-input" placeholder="e.g., Violin, Saxophone, Drums" value="${state.instrumentOther}">
          </div>
        ` : ''}

        <div class="sw-field">
          <label class="sw-label">Your City</label>
          <select id="sw-city" class="sw-select">
            <option value="">Choose your city...</option>
            ${cityOptions}
          </select>
        </div>

        <div class="sw-field">
          <label class="sw-label">Lesson Length</label>
          <select id="sw-length" class="sw-select">
            ${lengthOptions}
          </select>
          <div class="sw-bucket-hint">Trial covers your first 3 lessons. Standard rates apply after ($40/$60/$75 per lesson).</div>
        </div>

        <div class="sw-field">
          <label class="sw-label">Your Address <span class="sw-optional">(optional — for more accurate matching)</span></label>
          <input type="text" id="sw-address" class="sw-input" placeholder="123 Main St" value="${state.address}">
        </div>

        <div class="sw-field">
          <label class="sw-label">Preferred Days <span class="sw-optional">(optional — leave blank for any day)</span></label>
          <div class="sw-pill-row">
            ${DAYS_OF_WEEK.map(d => `
              <button type="button" class="sw-pill ${state.preferredDays.includes(d.v) ? 'sw-pill-on' : ''}" data-day="${d.v}">${d.label}</button>
            `).join('')}
          </div>
        </div>

        <div class="sw-field">
          <label class="sw-label">Preferred Times <span class="sw-optional">(optional)</span></label>
          <div class="sw-pill-row">
            ${TIME_BUCKETS.map(t => `
              <button type="button" class="sw-pill ${state.preferredTimes.includes(t.key) ? 'sw-pill-on' : ''}" data-time="${t.key}">${t.label}</button>
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
        <label class="sw-label">Filter by instructor</label>
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

    let slotsHtml = '';
    for (const group of groups) {
      slotsHtml += `<div class="sw-day-group">`;
      slotsHtml += `<div class="sw-day-label">${group.day}, ${new Date(group.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>`;
      slotsHtml += `<div class="sw-slots-row">`;
      for (const slot of group.slots) {
        const thisKey = slotKey(slot);
        const isRecommended = thisKey === recommendedKey && !state.filterInstructor;
        const isSelected = thisKey === selectedKey;
        slotsHtml += `
          <button class="sw-slot ${isSelected ? 'sw-slot-selected' : ''} ${isRecommended ? 'sw-slot-recommended' : ''}"
                  data-slot='${JSON.stringify(slot)}'>
            ${isRecommended ? '<span class="sw-badge">Best Match</span>' : ''}
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
          <strong>${slot.instructor_name}</strong> — ${slot.day}, ${formatTime(slot.time)}<br>
          First lesson of your <strong>3-lesson trial</strong> (${state.lessonLength} min ${state.instrument})
        </div>

        <div class="sw-field">
          <label class="sw-label">Your Name</label>
          <input type="text" id="sw-name" class="sw-input" placeholder="First and last name" value="${state.clientName}">
        </div>

        <div class="sw-field">
          <label class="sw-label">Email</label>
          <input type="email" id="sw-email" class="sw-input" placeholder="your@email.com" value="${state.clientEmail}">
        </div>

        <div class="sw-field">
          <label class="sw-label">Phone</label>
          <input type="tel" id="sw-phone" class="sw-input" placeholder="(555) 123-4567" value="${state.clientPhone}">
        </div>

        <div class="sw-field">
          <label class="sw-label">Lesson Address</label>
          <input type="text" id="sw-address-final" class="sw-input" placeholder="Full address where lessons will take place" value="${state.address}">
        </div>

        <!-- Honeypot -->
        <div style="position:absolute;left:-9999px;"><input type="text" id="sw-hp" tabindex="-1" autocomplete="off"></div>

        ${renderMcmcPayment()}

        <div class="sw-step2-actions">
          <button id="sw-back-2" class="sw-btn sw-btn-secondary">Back</button>
        </div>
      </div>
    `;
  }

  function renderMcmcPayment() {
    const price = state.config?.mcmc_prices?.[state.lessonLength];
    const hasPaypal = state.config?.paypal_client_id && price != null;
    if (!hasPaypal) {
      return `
        <button id="sw-submit" class="sw-btn sw-btn-primary" ${state.loading ? 'disabled' : ''}>
          ${state.loading ? '<span class="sw-spinner"></span> Booking...' : 'Book Trial Lesson'}
        </button>
      `;
    }
    // Per-lesson math so the discount feels concrete
    const standardPerLesson = state.lessonLength === 30 ? 40 : state.lessonLength === 45 ? 60 : 75;
    const trialPerLesson = standardPerLesson / 2;
    const standardTotal = standardPerLesson * 3;
    return `
      <div class="sw-pay-card">
        <div class="sw-pay-eyebrow">Trial Special — 50% off</div>
        <div class="sw-pay-headline">3 ${state.lessonLength}-min Lessons for $${price.toFixed(2)}</div>
        <div class="sw-pay-price-breakdown">
          That's <strong>$${trialPerLesson.toFixed(2)}/lesson</strong> instead of <s>$${standardPerLesson.toFixed(2)}</s> — you save $${(standardTotal - price).toFixed(2)}.
        </div>
        <div class="sw-pay-subtext">After your trial, lessons continue at the standard rate ($${standardPerLesson}/lesson). Refundable up to 48 hours before your first lesson.</div>
        <div id="sw-paypal-button" class="sw-paypal-button"></div>
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
            <div><strong>City:</strong> ${state.city || '—'}</div>
            <div><strong>Email:</strong> ${state.clientEmail}</div>
          </div>
          <p class="sw-subtext">Questions? Call us at <a href="tel:7605732120">(760) 573-2120</a>.</p>
          <button id="sw-done" class="sw-btn sw-btn-primary">Close</button>
        </div>
      `;
    }

    const headline = c.isCallback ? "We'll Call You Soon" : "Your Trial Is Booked!";
    const text = c.isCallback
      ? "Thanks! We've got your slot reserved and will call within 24 hours to walk you through everything."
      : `${c.message} You're set for your 3-lesson trial — we'll confirm the exact times for your 2nd and 3rd lessons within 24 hours.`;

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

        <div class="sw-field">
          <label class="sw-label">Your Name</label>
          <input type="text" id="sw-name" class="sw-input" placeholder="First and last name" value="${state.clientName}">
        </div>

        <div class="sw-field">
          <label class="sw-label">Email</label>
          <input type="email" id="sw-email" class="sw-input" placeholder="your@email.com" value="${state.clientEmail}">
        </div>

        <div class="sw-field">
          <label class="sw-label">Phone</label>
          <input type="tel" id="sw-phone" class="sw-input" placeholder="(555) 123-4567" value="${state.clientPhone}">
        </div>

        <div class="sw-field">
          <label class="sw-label">Anything else we should know? <span class="sw-optional">(optional)</span></label>
          <input type="text" id="sw-notes" class="sw-input" placeholder="e.g., student age, experience level, preferred days" value="${state.notes}">
        </div>

        <div style="position:absolute;left:-9999px;"><input type="text" id="sw-hp" tabindex="-1" autocomplete="off"></div>

        <div class="sw-step2-actions">
          <button id="sw-back-1" class="sw-btn sw-btn-secondary">Back</button>
          <button id="sw-submit-lead" class="sw-btn sw-btn-primary" ${state.loading ? 'disabled' : ''}>
            ${state.loading ? '<span class="sw-spinner"></span> Sending...' : 'Submit'}
          </button>
        </div>
      </div>
    `;
  }

  function renderLeadOnlyForm() {
    const instrumentOptions = INSTRUMENTS.map(i =>
      `<option value="${i}" ${state.instrument === i ? 'selected' : ''}>${i}</option>`
    ).join('');

    const cityName = state.city || 'your area';
    const headline = state.city
      ? `Music Lessons in ${cityName} — Reserve Your Spot`
      : 'Reserve Your Spot for Music Lessons';
    const subtext = `We're matching new students with instructors in ${cityName} and will reach out within 24 hours to confirm your fit. Most students start lessons within 1–3 weeks.`;

    return `
      <div class="sw-step">
        <h3 class="sw-heading">${headline}</h3>
        <p class="sw-subtext">${subtext}</p>

        <div class="sw-field">
          <label class="sw-label">Your Name</label>
          <input type="text" id="sw-name" class="sw-input" placeholder="First and last name" value="${state.clientName}">
        </div>

        <div class="sw-field">
          <label class="sw-label">Email</label>
          <input type="email" id="sw-email" class="sw-input" placeholder="your@email.com" value="${state.clientEmail}">
        </div>

        <div class="sw-field">
          <label class="sw-label">Phone</label>
          <input type="tel" id="sw-phone" class="sw-input" placeholder="(555) 123-4567" value="${state.clientPhone}">
        </div>

        <div class="sw-field">
          <label class="sw-label">Instrument of Interest</label>
          <select id="sw-instrument" class="sw-select">
            <option value="">Choose an instrument...</option>
            ${instrumentOptions}
          </select>
        </div>

        ${state.instrument === 'Other' ? `
          <div class="sw-field">
            <label class="sw-label">Which instrument?</label>
            <input type="text" id="sw-instrument-other" class="sw-input" placeholder="e.g., Violin, Saxophone" value="${state.instrumentOther}">
          </div>
        ` : ''}

        <div class="sw-field">
          <label class="sw-label">Student Age</label>
          <input type="text" id="sw-age" class="sw-input" placeholder='e.g. "8" or "Adult"' value="${state.studentAge}">
        </div>

        <div class="sw-field">
          <label class="sw-label">City</label>
          <input type="text" id="sw-city-text" class="sw-input" placeholder="Your city" value="${state.city}">
        </div>

        <div class="sw-field">
          <label class="sw-label">How soon would you like to start?</label>
          <select id="sw-timing" class="sw-select">
            <option value="">Choose...</option>
            <option value="asap" ${state.startTiming === 'asap' ? 'selected' : ''}>As soon as possible</option>
            <option value="within_month" ${state.startTiming === 'within_month' ? 'selected' : ''}>Within the next month</option>
            <option value="exploring" ${state.startTiming === 'exploring' ? 'selected' : ''}>Just exploring</option>
          </select>
        </div>

        <div class="sw-field">
          <label class="sw-label">Anything else we should know? <span class="sw-optional">(optional)</span></label>
          <textarea id="sw-notes" class="sw-input" rows="3" placeholder="Goals, preferred days/times, experience level">${state.notes}</textarea>
        </div>

        <div style="position:absolute;left:-9999px;"><input type="text" id="sw-hp" tabindex="-1" autocomplete="off"></div>

        ${renderMmDeposit()}
      </div>
    `;
  }

  function renderMmDeposit() {
    const deposit = state.config?.mm_deposit;
    const hasPaypal = state.config?.paypal_client_id && deposit != null;
    if (!hasPaypal) {
      // PayPal not configured yet — fall back to no-deposit submission
      return `
        <button id="sw-submit-lead" class="sw-btn sw-btn-primary" ${state.loading ? 'disabled' : ''}>
          ${state.loading ? '<span class="sw-spinner"></span> Sending...' : 'Reserve My Spot'}
        </button>
        <p class="sw-fineprint">We'll get back to you within 24 hours. Your info stays private.</p>
      `;
    }
    return `
      <div class="sw-pay-card">
        <div class="sw-pay-headline">Reserve with a $${deposit.toFixed(2)} deposit</div>
        <div class="sw-pay-subtext">Applied to your first lesson. Refundable up to 48 hours before your scheduled start.</div>
        <div id="sw-paypal-button" class="sw-paypal-button"></div>
      </div>
      <p class="sw-fineprint">We'll reach out within 24 hours to confirm your fit. Your info stays private.</p>
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
      state.error = '';
      // Re-render so "Other" text input appears/disappears
      render();
    });

    const instrumentOtherInput = document.getElementById('sw-instrument-other');
    if (instrumentOtherInput) instrumentOtherInput.addEventListener('input', e => {
      state.instrumentOther = e.target.value;
    });

    const citySel = document.getElementById('sw-city');
    if (citySel) citySel.addEventListener('change', e => { state.city = e.target.value; state.error = ''; });

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
    if (nameInput) nameInput.addEventListener('input', e => { state.clientName = e.target.value; });

    const emailInput = document.getElementById('sw-email');
    if (emailInput) emailInput.addEventListener('input', e => { state.clientEmail = e.target.value; });

    const phoneInput = document.getElementById('sw-phone');
    if (phoneInput) phoneInput.addEventListener('input', e => { state.clientPhone = e.target.value; });

    const addrFinal = document.getElementById('sw-address-final');
    if (addrFinal) addrFinal.addEventListener('input', e => { state.address = e.target.value; });

    const submitBtn = document.getElementById('sw-submit');
    if (submitBtn) submitBtn.addEventListener('click', handleBooking);

    // Step 5 (lead capture)
    const notesInput = document.getElementById('sw-notes');
    if (notesInput) notesInput.addEventListener('input', e => { state.notes = e.target.value; });

    const ageInput = document.getElementById('sw-age');
    if (ageInput) ageInput.addEventListener('input', e => { state.studentAge = e.target.value; });

    const cityTextInput = document.getElementById('sw-city-text');
    if (cityTextInput) cityTextInput.addEventListener('input', e => { state.city = e.target.value; });

    const timingSel = document.getElementById('sw-timing');
    if (timingSel) timingSel.addEventListener('change', e => { state.startTiming = e.target.value; });

    const submitLeadBtn = document.getElementById('sw-submit-lead');
    if (submitLeadBtn) submitLeadBtn.addEventListener('click', handleLeadSubmit);

    // Callback link (MCMC step 3 alternative to paying)
    const callbackBtn = document.getElementById('sw-callback');
    if (callbackBtn) callbackBtn.addEventListener('click', handleCallbackRequest);

    // Mount PayPal Smart Buttons if container is present
    mountPaypalButton();

    // Step 4
    const doneBtn = document.getElementById('sw-done');
    if (doneBtn) doneBtn.addEventListener('click', () => { closeModalDirect(); resetState(); });
  }

  async function handleFindSlots() {
    if (!state.instrument) { state.error = 'Please select an instrument.'; render(); return; }
    if (state.instrument === 'Other' && !state.instrumentOther.trim()) {
      state.error = 'Please tell us which instrument.'; render(); return;
    }
    if (!state.city) { state.error = 'Please select your city.'; render(); return; }

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

  async function handleLeadSubmit() {
    if (!state.clientName.trim()) { state.error = 'Please enter your name.'; render(); return; }
    if (!state.clientEmail.trim() || !state.clientEmail.includes('@')) {
      state.error = 'Please enter a valid email.'; render(); return;
    }
    if (LEAD_ONLY) {
      if (!state.clientPhone.trim()) { state.error = 'Please enter your phone number.'; render(); return; }
      if (!state.instrument) { state.error = 'Please select an instrument.'; render(); return; }
      if (state.instrument === 'Other' && !state.instrumentOther.trim()) {
        state.error = 'Please tell us which instrument.'; render(); return;
      }
      if (!state.studentAge.trim()) { state.error = 'Please enter the student age.'; render(); return; }
      if (!state.city.trim()) { state.error = 'Please enter your city.'; render(); return; }
      if (!state.startTiming) { state.error = 'Please tell us how soon you want to start.'; render(); return; }
    }

    const hp = document.getElementById('sw-hp');
    if (hp && hp.value) return;

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
        start_timing: state.startTiming || undefined,
        notes: state.notes.trim() || undefined,
        brand_source: BRAND_SOURCE,
        honeypot: '',
      });

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
    if (!state.clientName.trim()) { state.error = 'Please enter your name.'; render(); return; }
    if (!state.clientEmail.trim() || !state.clientEmail.includes('@')) { state.error = 'Please enter a valid email.'; render(); return; }
    if (!state.address.trim()) { state.error = 'Please enter your lesson address.'; render(); return; }

    // Honeypot check
    const hp = document.getElementById('sw-hp');
    if (hp && hp.value) return;

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
        window.location.href = THANK_YOU_REDIRECT;
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

  function mountPaypalButton() {
    const container = document.getElementById('sw-paypal-button');
    if (!container) return;
    const clientId = state.config?.paypal_client_id;
    if (!clientId) return;

    let amount = 0;
    let onApproveHandler = null;

    if (LEAD_ONLY) {
      amount = state.config?.mm_deposit;
      onApproveHandler = (orderId) => handleLeadSubmitWithPayment(orderId);
    } else {
      // MCMC booking flow
      amount = state.config?.mcmc_prices?.[state.lessonLength];
      onApproveHandler = (orderId) => handleBookingWithPayment(orderId);
    }

    if (!amount) return;

    loadPaypalSdk(clientId).then(paypal => {
      // Validate fields BEFORE letting PayPal open. Errors shown inline.
      const validateBeforePay = () => {
        if (!state.clientName.trim()) { state.error = 'Please enter your name.'; render(); return false; }
        if (!state.clientEmail.trim() || !state.clientEmail.includes('@')) {
          state.error = 'Please enter a valid email.'; render(); return false;
        }
        if (LEAD_ONLY) {
          if (!state.clientPhone.trim()) { state.error = 'Please enter your phone number.'; render(); return false; }
          if (!state.instrument) { state.error = 'Please select an instrument.'; render(); return false; }
          if (state.instrument === 'Other' && !state.instrumentOther.trim()) {
            state.error = 'Please tell us which instrument.'; render(); return false;
          }
          if (!state.studentAge.trim()) { state.error = 'Please enter the student age.'; render(); return false; }
          if (!state.city.trim()) { state.error = 'Please enter your city.'; render(); return false; }
          if (!state.startTiming) { state.error = 'Please tell us how soon you want to start.'; render(); return false; }
        } else {
          if (!state.address.trim()) { state.error = 'Please enter your lesson address.'; render(); return false; }
        }
        return true;
      };

      paypal.Buttons({
        style: { color: 'gold', shape: 'rect', label: 'pay', height: 44 },
        onClick: async (data, actions) => {
          if (!validateBeforePay()) return actions.reject();

          // For MCMC bookings only: re-check that the selected slot is still
          // available before opening PayPal. Avoids the case where a user pays
          // and then can't be booked because the slot was just taken.
          if (!LEAD_ONLY && state.selectedSlot) {
            try {
              const refreshed = await fetchAvailability({
                instrument: state.instrument,
                city: state.city,
                lesson_length: state.lessonLength,
                address: state.address || undefined,
              });
              const slotKeyOf = s => s ? `${s.instructor_id}|${s.date}|${s.time}` : '';
              const targetKey = slotKeyOf(state.selectedSlot);
              const allRefreshed = ([refreshed.recommended].concat(refreshed.alternatives || [])).filter(Boolean);
              const stillAvailable = allRefreshed.some(s => slotKeyOf(s) === targetKey);
              if (!stillAvailable) {
                state.error = 'That time slot was just taken. Please go back and pick another time — no payment was charged.';
                state.step = 2;
                state.selectedSlot = null;
                state.slots = refreshed;
                render();
                return actions.reject();
              }
            } catch (e) {
              // If the check fails, let the user proceed anyway
              console.warn('Slot pre-check failed:', e);
            }
          }

          return actions.resolve();
        },
        createOrder: (data, actions) => actions.order.create({
          purchase_units: [{
            description: LEAD_ONLY
              ? 'Music & Mastery — Lesson reservation deposit'
              : `Mountain City Music — First 3 ${state.lessonLength}-min ${state.instrument} lessons (50% off)`,
            amount: { value: amount.toFixed(2), currency_code: 'USD' },
          }],
        }),
        onApprove: async (data, actions) => {
          await actions.order.capture();  // captures the funds via PayPal SDK
          await onApproveHandler(data.orderID);
        },
        onError: (err) => {
          console.error('PayPal error:', err);
          state.error = 'Payment failed. Please try again or use the callback option.';
          render();
        },
      }).render('#sw-paypal-button');
    }).catch(err => {
      console.warn('PayPal SDK load failed:', err);
      // Hide the deposit card so the user isn't stuck with a broken button
      container.parentElement && container.parentElement.remove();
    });
  }

  async function handleBookingWithPayment(orderId) {
    state.loading = true; state.error = ''; render();
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
        paypal_order_id: orderId,
        honeypot: '',
      });
      if (typeof gtag === 'function') {
        gtag('event', 'form_submission', { event_category: 'booking_paid', event_label: state.instrument });
      }
      if (THANK_YOU_REDIRECT) {
        window.location.href = buildRedirectUrl({
          type: 'paid',
          instructor: result.instructor_name,
          day: result.day,
          time: result.time,
          duration: state.lessonLength,
          instrument: state.instrument,
        });
        return;
      }
      state.confirmation = result; state.step = 4;
    } catch (e) {
      // Critical: payment was captured but booking failed. Show a banner-style
      // error and surface the PayPal order ID so support can refund manually.
      state.error = `IMPORTANT: Your payment of $${(state.config?.mcmc_prices?.[state.lessonLength] || 0).toFixed(2)} went through, but we couldn't save your booking (${e.message || 'unknown error'}). PayPal order ID: ${orderId}. Please call us at (760) 573-2120 right away — we'll either book you in or refund you immediately.`;
    }
    state.loading = false; render();
  }

  async function handleCallbackRequest() {
    state.loading = true; state.error = ''; render();
    try {
      // Collect contact info exactly like a paid booking, but no PayPal
      if (!state.clientName.trim()) throw new Error('Please enter your name.');
      if (!state.clientEmail.trim() || !state.clientEmail.includes('@')) throw new Error('Please enter a valid email.');
      if (!state.address.trim()) throw new Error('Please enter your lesson address.');

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

  async function handleLeadSubmitWithPayment(orderId) {
    state.loading = true; state.error = ''; render();
    try {
      const result = await submitLead({
        client_name: state.clientName.trim(),
        email: state.clientEmail.trim(),
        phone: state.clientPhone.trim(),
        instrument: state.instrument,
        instrument_other: state.instrumentOther.trim() || undefined,
        city: state.city.trim() || undefined,
        student_age: state.studentAge.trim() || undefined,
        start_timing: state.startTiming || undefined,
        notes: state.notes.trim() || undefined,
        brand_source: BRAND_SOURCE,
        paypal_order_id: orderId,
        honeypot: '',
      });
      if (typeof gtag === 'function') {
        gtag('event', 'form_submission', { event_category: 'lead_paid', event_label: state.instrument });
      }
      if (THANK_YOU_REDIRECT) {
        window.location.href = buildRedirectUrl({
          type: 'deposit',
          instrument: state.instrument === 'Other' ? state.instrumentOther : state.instrument,
          city: state.city,
          deposit: state.config?.mm_deposit,
        });
        return;
      }
      state.confirmation = { ...result, isLead: true, isPaid: true }; state.step = 4;
    } catch (e) {
      state.error = e.message || 'Submission failed after payment. Please contact us.';
    }
    state.loading = false; render();
  }

  function resetState() {
    const cachedCities = state.cities;
    const cachedConfig = state.config;
    state = freshState();
    state.cities = cachedCities;
    state.config = cachedConfig;
    if (typeof window.MCMC_PREFILL_CITY === 'string' && window.MCMC_PREFILL_CITY) {
      if (LEAD_ONLY || cachedCities.includes(window.MCMC_PREFILL_CITY)) {
        state.city = window.MCMC_PREFILL_CITY;
      }
    }
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
        background: #726edd;
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
      textarea.sw-input { resize: vertical; min-height: 88px; font-family: 'Questrial', sans-serif; }
      .sw-fineprint { font-family: 'Questrial', sans-serif; font-size: 12px; color: #888; text-align: center; margin: 14px 0 0; }

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
      .sw-paypal-button { min-height: 44px; }
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
      .sw-spinner {
        width: 16px; height: 16px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: sw-spin 0.6s linear infinite;
      }
      @keyframes sw-spin { to { transform: rotate(360deg); } }

      /* Step 2 — Slots */
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
        background: #f9f8ff;
        box-shadow: 0 2px 12px rgba(114,110,221,0.2);
      }
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
      .sw-slot-time {
        font-family: 'Montserrat', sans-serif;
        font-weight: 700;
        font-size: 14px;
      }
      .sw-slot-instructor { font-size: 12px; color: #666; margin-top: 2px; }
      .sw-step2-actions { display: flex; gap: 12px; margin-top: 16px; }
      .sw-step2-actions .sw-btn-primary { flex: 1; }

      /* Step 3 — Contact */
      .sw-selection-summary {
        background: #f9f8ff;
        border: 1px solid rgba(114,110,221,0.2);
        border-radius: 12px;
        padding: 12px 16px;
        font-size: 14px;
        margin-bottom: 20px;
      }

      /* Step 4 — Confirmation */
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

    // Load config (PayPal client ID + pricing) up front so payment buttons are ready
    try {
      state.config = await fetchConfig();
    } catch (e) {
      console.warn('Could not load widget config:', e);
    }

    // Load cities on init (skip in lead-only mode — that flow uses a city text input)
    if (!LEAD_ONLY) {
      try {
        state.cities = await fetchCities();
      } catch (e) {
        console.warn('Could not pre-load cities:', e);
      }
    }

    // Apply city pre-fill. In MCMC mode this matches the cities dropdown;
    // in lead-only mode the city is just text.
    if (typeof window.MCMC_PREFILL_CITY === 'string' && window.MCMC_PREFILL_CITY) {
      if (LEAD_ONLY || state.cities.includes(window.MCMC_PREFILL_CITY)) {
        state.city = window.MCMC_PREFILL_CITY;
      }
    }

    // In lead-only mode, the multi-step booking flow doesn't apply.
    // Open straight to the lead form (step 5).
    if (LEAD_ONLY) {
      state.step = 5;
      state.mode = 'lead_only';
    }

    if (inlineMode) {
      // Inline mode — render immediately and stay rendered
      render();
    } else {
      // Modal mode — wrap openModal/closeModal so we render on each open
      const origOpenModal = window.openModal;
      window.openModal = function() {
        origOpenModal();
        resetState();
        render();
      };
    }
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
