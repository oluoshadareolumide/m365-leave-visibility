/* ============================================================================
   Hakim Group — IT Support Portal · client logic
   - Loads a CAPTCHA challenge and public config from the API
   - Validates input for UX (the server re-validates everything)
   - Submits the ticket and renders success / error states
   No inline scripts/handlers, so it works under a strict Content-Security-Policy.
   ============================================================================ */
(function () {
  'use strict';

  var apiBase = (document.body.getAttribute('data-api-base') || '').replace(/\/+$/, '');
  function api(path) {
    return apiBase + path;
  }

  // ── Element refs ──────────────────────────────────────────────────────────
  var form = document.getElementById('ticket-form');
  var successPanel = document.getElementById('success-panel');
  var formStatus = document.getElementById('form-status');
  var submitBtn = document.getElementById('submit-btn');

  var questionEl = document.getElementById('captcha-question');
  var answerEl = document.getElementById('captchaAnswer');
  var captchaRefresh = document.getElementById('captcha-refresh');
  var captchaBuiltin = document.getElementById('captcha-builtin');

  var descEl = document.getElementById('problemDescription');
  var counterEl = document.getElementById('problemDescription-counter');
  var loadedAtEl = document.getElementById('formLoadedAt');

  var FIELDS = ['practiceName', 'practiceLocation', 'contactName', 'phone', 'email', 'problemDescription'];

  // ── State ─────────────────────────────────────────────────────────────────
  var captchaProvider = 'builtin';
  var captchaToken = '';
  var supportEmail = 'it.support@hakimgroup.co.uk';

  // ── Helpers ───────────────────────────────────────────────────────────────
  function byId(id) {
    return document.getElementById(id);
  }

  function setFieldError(field, message) {
    var errEl = byId(field + '-error');
    if (errEl) errEl.textContent = message || '';
    var input = byId(field);
    var wrap = input && input.closest ? input.closest('.hg-field') : null;
    if (!wrap && errEl && errEl.closest) wrap = errEl.closest('.hg-field');
    if (wrap) {
      if (message) wrap.classList.add('is-invalid');
      else wrap.classList.remove('is-invalid');
    }
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function clearErrors() {
    var errs = document.querySelectorAll('.hg-error');
    for (var i = 0; i < errs.length; i++) errs[i].textContent = '';
    var invalid = document.querySelectorAll('.hg-field.is-invalid');
    for (var j = 0; j < invalid.length; j++) invalid[j].classList.remove('is-invalid');
    var aria = document.querySelectorAll('[aria-invalid="true"]');
    for (var k = 0; k < aria.length; k++) aria[k].removeAttribute('aria-invalid');
    formStatus.textContent = '';
  }

  function value(id) {
    var el = byId(id);
    return el ? el.value.trim() : '';
  }

  function getUrgency() {
    var checked = form.querySelector('input[name="urgency"]:checked');
    return checked ? checked.value : '';
  }

  // ── Config + email links ──────────────────────────────────────────────────
  function setEmailLinks() {
    var mailto = 'mailto:' + supportEmail;
    var hdr = byId('support-email-link');
    if (hdr) hdr.setAttribute('href', mailto);
    var ftr = byId('footer-email');
    if (ftr) {
      ftr.setAttribute('href', mailto);
      ftr.textContent = supportEmail;
    }
  }

  function loadConfig() {
    return fetch(api('/api/tickets/config'))
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (cfg) {
        if (cfg) {
          captchaProvider = cfg.captchaProvider || 'builtin';
          if (cfg.supportEmail) supportEmail = cfg.supportEmail;
        }
      })
      .catch(function () {
        /* keep defaults */
      })
      .then(function () {
        setEmailLinks();
        if (captchaProvider === 'builtin') {
          loadCaptcha();
        } else {
          // Third-party widgets need their own script + a relaxed CSP. The
          // built-in challenge is the default; see docs/SUPPORT_PORTAL.md.
          captchaBuiltin.hidden = true;
          questionEl.textContent = '';
        }
      });
  }

  // ── CAPTCHA ───────────────────────────────────────────────────────────────
  function loadCaptcha() {
    questionEl.textContent = 'Loading…';
    captchaToken = '';
    return fetch(api('/api/tickets/captcha'), { cache: 'no-store' })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        captchaToken = data.token || '';
        questionEl.textContent = data.question || '';
        if (answerEl) answerEl.value = '';
      })
      .catch(function () {
        questionEl.textContent = '(couldn’t load — tap "New question")';
      });
  }

  // ── Client-side validation (mirrors the server, for fast feedback) ────────
  var PHONE_RE = /^[+0-9 ()./-]{7,20}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validate() {
    var errors = {};
    if (!value('practiceName')) errors.practiceName = 'Practice name is required.';
    if (!value('practiceLocation')) errors.practiceLocation = 'Practice location is required.';
    if (!value('contactName')) errors.contactName = 'Contact name is required.';

    var phone = value('phone');
    if (!phone) errors.phone = 'Phone number is required.';
    else if (!PHONE_RE.test(phone)) errors.phone = 'Enter a valid phone number.';

    var email = value('email');
    if (email && !EMAIL_RE.test(email)) errors.email = 'Enter a valid email address, or leave it blank.';

    var desc = value('problemDescription');
    if (!desc) errors.problemDescription = 'Problem description is required.';
    else if (desc.length < 10) errors.problemDescription = 'Please add a little more detail (at least 10 characters).';

    if (!getUrgency()) errors.urgency = 'Select how urgent the issue is.';

    if (captchaProvider === 'builtin' && !value('captchaAnswer')) {
      errors.captcha = 'Please answer the verification question.';
    }
    return errors;
  }

  function showErrors(errors) {
    var first = null;
    var keys = Object.keys(errors);
    for (var i = 0; i < keys.length; i++) {
      setFieldError(keys[i], errors[keys[i]]);
      if (!first) first = keys[i];
    }
    if (first) {
      var el = byId(first) || byId(first + '-error');
      if (el && el.focus) {
        try {
          el.focus({ preventScroll: false });
        } catch (e) {
          el.focus();
        }
      }
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  function setLoading(on) {
    if (on) {
      submitBtn.classList.add('is-loading');
      submitBtn.disabled = true;
    } else {
      submitBtn.classList.remove('is-loading');
      submitBtn.disabled = false;
    }
  }

  function buildPayload() {
    return {
      practiceName: value('practiceName'),
      practiceLocation: value('practiceLocation'),
      contactName: value('contactName'),
      phone: value('phone'),
      email: value('email'),
      problemDescription: value('problemDescription'),
      urgency: getUrgency(),
      captchaToken: captchaToken,
      captchaAnswer: value('captchaAnswer'),
      website: value('website'), // honeypot
      formLoadedAt: Number(loadedAtEl && loadedAtEl.value) || 0
    };
  }

  function onSubmit(e) {
    e.preventDefault();
    clearErrors();

    var errors = validate();
    if (Object.keys(errors).length) {
      showErrors(errors);
      formStatus.textContent = 'Please check the highlighted fields.';
      return;
    }

    setLoading(true);
    fetch(api('/api/tickets'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(buildPayload())
    })
      .then(function (res) {
        return res.json().catch(function () {
          return {};
        }).then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (r) {
        if (r.status === 201) {
          showSuccess(r.data);
          return;
        }
        handleServerError(r.data);
      })
      .catch(function () {
        formStatus.textContent = 'Network error — please check your connection and try again.';
      })
      .then(function () {
        setLoading(false);
      });
  }

  function handleServerError(data) {
    if (data && Array.isArray(data.errors)) {
      var mapped = {};
      data.errors.forEach(function (err) {
        mapped[err.field] = err.message;
      });
      showErrors(mapped);
    }
    formStatus.textContent =
      (data && data.message) || 'Sorry, something went wrong. Please try again.';
    // A fresh challenge after any failure (the previous one may be spent).
    if (captchaProvider === 'builtin') loadCaptcha();
  }

  // ── Success ───────────────────────────────────────────────────────────────
  function showSuccess(data) {
    byId('success-ref').textContent = data.reference || '—';

    var badge = byId('success-priority');
    var high = data.priority === 'high';
    badge.textContent = high ? 'High' : 'Normal';
    badge.className = 'hg-badge ' + (high ? 'hg-badge--high' : 'hg-badge--normal');

    byId('success-message').textContent =
      data.message ||
      (high
        ? 'Your urgent request has been sent to our IT team for immediate attention.'
        : 'Your request has been added to our support queue.');

    byId('success-next').textContent = high
      ? 'Keep your phone to hand — our team may call you on the number you provided.'
      : "We'll be in touch on the next business day. You can keep working in the meantime.";

    form.hidden = true;
    successPanel.hidden = false;
    successPanel.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    form.reset();
    clearErrors();
    updateCounter();
    syncUrgencySelection();
    successPanel.hidden = true;
    form.hidden = false;
    stampLoadedAt();
    if (captchaProvider === 'builtin') loadCaptcha();
    var firstInput = byId('practiceName');
    if (firstInput) firstInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Small enhancements ────────────────────────────────────────────────────
  function updateCounter() {
    if (!descEl || !counterEl) return;
    counterEl.textContent = descEl.value.length + ' / 4000';
  }

  function syncUrgencySelection() {
    var labels = document.querySelectorAll('.hg-choice');
    for (var i = 0; i < labels.length; i++) {
      var input = labels[i].querySelector('input');
      if (input && input.checked) labels[i].classList.add('is-selected');
      else labels[i].classList.remove('is-selected');
    }
  }

  function stampLoadedAt() {
    if (loadedAtEl) loadedAtEl.value = String(Date.now());
  }

  // ── Wire up ───────────────────────────────────────────────────────────────
  form.addEventListener('submit', onSubmit);
  if (captchaRefresh) captchaRefresh.addEventListener('click', loadCaptcha);
  if (descEl) descEl.addEventListener('input', updateCounter);
  byId('another-btn').addEventListener('click', resetForm);

  var urgencyInputs = document.querySelectorAll('input[name="urgency"]');
  for (var i = 0; i < urgencyInputs.length; i++) {
    urgencyInputs[i].addEventListener('change', function () {
      syncUrgencySelection();
      setFieldError('urgency', '');
    });
  }
  // Clear a field's error as soon as the user edits it.
  FIELDS.forEach(function (f) {
    var el = byId(f);
    if (el) {
      el.addEventListener('input', function () {
        setFieldError(f, '');
      });
    }
  });

  stampLoadedAt();
  updateCounter();
  syncUrgencySelection();
  loadConfig();
})();
