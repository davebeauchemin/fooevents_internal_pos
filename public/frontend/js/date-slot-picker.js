jQuery(document).ready(function ($) {
  // Set fipos_enable_custom_time_slot_picker to true in PHP (filter) to use pill grid; default is native <select>.
  var pickerCfg = window.fiposDateSlotPicker || {};
  var useCustomTimeSlots = !!(pickerCfg && pickerCfg.customTimeSlots);

  var DATE_SELECT_SEL = 'select[name="fooevents_bookings_date_val__trans"]';
  var SLOT_SELECT_SEL = 'select[name="fooevents_bookings_slot_val__trans"]';
  /** Product add-to-cart form that actually contains FooEvents booking selects (sticky bars may register a second unrelated form.cart first). */
  var $cartForm = $('form.cart').filter(function () {
    return $(this).find(DATE_SELECT_SEL).length > 0;
  }).first();
  if (!$cartForm.length) {
    $cartForm = $('form.cart').first();
  }

  var $dateSelect = $cartForm.find(DATE_SELECT_SEL).first();
  var $slotSelect = $cartForm.find(SLOT_SELECT_SEL).first();

  /** Wrappers (<p.form-row>) for the selects we sync; used for kiosk placement instead of brittle #field ids when IDs repeat. */
  var $dateFieldRow;
  var $slotFieldRow;
  var currentSelectedDateYmd = '';
  var currentSelectedDateLabel = '';

  // Promo bundle chips set the real WooCommerce quantity field, then let Woo/FooEvents react.
  function getQuantityInput() {
    var $qty = $('form.cart input.qty').first();
    if (!$qty.length) {
      $qty = $('input[name="quantity"]').first();
    }
    return $qty;
  }

  function numericAttr($el, attr) {
    var raw = $el.attr(attr);
    if (raw === undefined || raw === '' || raw === 'any') return null;
    var val = parseFloat(raw);
    return Number.isFinite(val) ? val : null;
  }

  function clampQuantity($qty, requested) {
    var min = numericAttr($qty, 'min');
    var max = numericAttr($qty, 'max');
    var step = numericAttr($qty, 'step');
    var val = parseFloat(requested);

    if (!Number.isFinite(val)) return null;
    if (min === null) min = 1;
    if (step === null || step <= 0) step = 1;

    val = Math.max(min, val);
    if (max !== null) val = Math.min(max, val);

    // Align to the quantity input step while keeping the value inside bounds.
    val = min + (Math.round((val - min) / step) * step);
    if (max !== null) val = Math.min(max, val);
    val = Math.max(min, val);

    return Math.round(val * 1000000) / 1000000;
  }

  function syncBundleChipState() {
    var $qty = getQuantityInput();
    var current = $qty.length ? parseFloat($qty.val()) : NaN;

    $('.fipos-dynamic-bundle-pricing__badge[data-fipos-bundle-qty]').each(function () {
      var $chip = $(this);
      var qty = parseFloat($chip.attr('data-fipos-bundle-qty'));
      var active = Number.isFinite(current) && Number.isFinite(qty) && current === qty;

      $chip
        .attr({ role: 'button', tabindex: '0', 'aria-pressed': active ? 'true' : 'false' })
        .toggleClass('is-selected', active);
    });
  }

  $(document).on('click', '.fipos-dynamic-bundle-pricing__badge[data-fipos-bundle-qty]', function (e) {
    e.preventDefault();

    var $chip = $(this);
    var $qty = getQuantityInput();
    if (!$qty.length) return;

    var qty = clampQuantity($qty, $chip.attr('data-fipos-bundle-qty'));
    if (qty === null) return;

    $qty.val(qty).trigger('input').trigger('change');
    syncBundleChipState();
  });

  $(document).on('keydown', '.fipos-dynamic-bundle-pricing__badge[data-fipos-bundle-qty]', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    $(this).trigger('click');
  });

  $(document).on('input change', 'form.cart input.qty, input[name="quantity"]', syncBundleChipState);
  syncBundleChipState();

  if (!$dateSelect.length) return;

  // FooEvents/themes sometimes duplicate booking fields in one form (duplicate illegal ids). Hide every echoed row so only the kiosk UI stays visible.
  $dateFieldRow = $dateSelect.closest('p.form-row');
  $slotFieldRow = $slotSelect.closest('p.form-row');
  $cartForm.find(DATE_SELECT_SEL).each(function () {
    $(this).closest('p.form-row').hide();
  });
  $cartForm.find(SLOT_SELECT_SEL).each(function () {
    $(this).closest('p.form-row').hide();
  });
  $cartForm.find('#fooevents-checkout-attendee-info-val-trans').slice(1).remove();

  function kbmSlotAreaEl() {
    return $cartForm.find('#kbm-slot-area').first();
  }

  // ─── SVG icons ───────────────────────────────────────────────────────────────

  var SVG_PREV = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  var SVG_NEXT = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

  function makeArrow(direction) {
    var svg = direction === 'prev' ? SVG_PREV : SVG_NEXT;
    return $('<button type="button" class="kbm-slider__arrow kbm-slider__arrow--' + direction + '" aria-label="' + (direction === 'prev' ? 'Previous' : 'Next') + '"></button>').append(svg);
  }

  // ─── Shared pager (translateX + drag) ────────────────────────────────────────
  // Wires up slide navigation and drag/swipe on any viewport+track pair.
  // Returns goToSlide(index) for external use.

  function makePager($viewport, $track, total, $prev, $next, onChange) {
    var current = 0;
    var dragStartX = 0, dragDeltaX = 0, dragging = false, wasDragged = false;
    var THRESHOLD = 50, DRAG_MIN = 5;

    function goToSlide(index) {
      current = Math.max(0, Math.min(index, total - 1));
      $track.css('transition', 'transform 0.3s ease')
        .css('transform', 'translateX(-' + (current * 100) + '%)');
      $prev.toggleClass('kbm-slider__arrow--hidden', current === 0);
      $next.toggleClass('kbm-slider__arrow--hidden', current === total - 1);
      if (typeof onChange === 'function') onChange(current);
    }

    function dragStart(x) { dragStartX = x; dragDeltaX = 0; dragging = true; wasDragged = false; $track.css('transition', 'none'); }
    function dragMove(x) {
      if (!dragging) return;
      dragDeltaX = x - dragStartX;
      if (Math.abs(dragDeltaX) > DRAG_MIN) wasDragged = true;
      $track.css('transform', 'translateX(' + (-(current * 100) + (dragDeltaX / $viewport.outerWidth()) * 100) + '%)');
    }
    function dragEnd() {
      if (!dragging) return;
      dragging = false;
      if (dragDeltaX < -THRESHOLD) goToSlide(current + 1);
      else if (dragDeltaX > THRESHOLD) goToSlide(current - 1);
      else goToSlide(current);
    }

    // Suppress click on pills if a drag just occurred (capture phase)
    $viewport[0].addEventListener('click', function (e) {
      if (wasDragged) { e.stopPropagation(); e.preventDefault(); wasDragged = false; }
    }, true);

    $prev.on('click', function () { goToSlide(current - 1); });
    $next.on('click', function () { goToSlide(current + 1); });

    $viewport.on('mousedown', function (e) { dragStart(e.clientX); });
    $(document).on('mousemove.kbmpager mouseup.kbmpager', function (e) {
      e.type === 'mousemove' ? dragMove(e.clientX) : dragEnd();
    });

    var el = $viewport[0];
    el.addEventListener('touchstart', function (e) { dragStart(e.touches[0].clientX); }, { passive: true });
    el.addEventListener('touchmove', function (e) { dragMove(e.touches[0].clientX); if (Math.abs(dragDeltaX) > 10) e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', function () { dragEnd(); }, { passive: true });

    return goToSlide;
  }

  // ─── Date / slot normalization (PHP slotMaps preferred) ─────────────────────────

  function dateLikeToYmd(raw) {
    raw = String(raw || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    var d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  /**
   * Resolve Y-m-d for the FooEvents/Woo date <option value> using PHP-normalized maps when present.
   */
  function resolveDateYmd(value, label) {
    var maps = pickerCfg.slotMaps;
    value = String(value || '').trim();
    if (maps && maps.dateKeyToYmd && maps.dateKeyToYmd[value]) {
      return maps.dateKeyToYmd[value];
    }
    var dm = value.match(/^(\d{4}-\d{2}-\d{2})_\d+$/);
    if (dm) return dm[1];
    return dateLikeToYmd(value) || dateLikeToYmd(label || '');
  }

  function ymdLocalNoonWeekday(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
    var d = new Date(ymd + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { weekday: 'long' });
  }

  /** 24h HH:MM from minute-of-day (site-local semantics match PHP slot metadata). */
  function minuteOfDayToHhMm(mod) {
    if (typeof mod !== 'number' || mod < 0 || mod >= 1440) return '';
    var h24 = Math.floor(mod / 60);
    var mm = mod % 60;
    return String(h24).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  function parseSlotLabel(label) {
    var m = label.match(/\((\d{1,2}):(\d{2})(?:\s*(a\.m\.|p\.m\.))?\)/i);
    if (!m) {
      return { hourKey: label, timeLabel: label, slideTitle: label, category: '', displayLabel: label, minuteOfDay: null };
    }
    var h = parseInt(m[1], 10);
    var apRaw = m[3] ? m[3].replace(/\./g, '').toLowerCase() : '';
    var h24;
    if (apRaw === 'am' || apRaw === 'pm') {
      if (apRaw === 'pm' && h < 12) h24 = h + 12;
      else if (apRaw === 'am' && h === 12) h24 = 0;
      else h24 = h;
    } else {
      // No a.m./p.m.: treat as already 24h (e.g. slot configured as 20:00).
      h24 = h;
    }
    var hourKey = String(h24);
    var category = label.replace(/\s*\([^)]*\)\s*$/, '').trim();
    var mmDigits = String(parseInt(m[2], 10)).padStart(2, '0');
    var minuteOfDay = (h24 * 60) + parseInt(mmDigits, 10);
    var timeHhMm = minuteOfDayToHhMm(minuteOfDay);
    // Hour buckets and nav: anchored at HH:00 in 24h (e.g. 22:00, not "10 PM").
    var slideTitle = String(h24).padStart(2, '0') + ':00';

    // Pill text: "Category · 22:35". If duplicate time-only category, collapse.
    var displayLabel;
    var catHm = category.match(/^(\d{1,2}):(\d{2})$/);
    if (catHm) {
      var catM = parseInt(catHm[1], 10) * 60 + parseInt(catHm[2], 10);
      if (catM === minuteOfDay) {
        displayLabel = timeHhMm;
      } else {
        displayLabel = category + ' \u00b7 ' + timeHhMm;
      }
    } else if (category) {
      displayLabel = category + ' \u00b7 ' + timeHhMm;
    } else {
      displayLabel = timeHhMm;
    }

    return {
      hourKey: hourKey,
      timeLabel: timeHhMm,
      slideTitle: slideTitle,
      category: category,
      displayLabel: displayLabel,
      minuteOfDay: minuteOfDay
    };
  }

  /**
   * Prefer authoritative slot time/minuteOfDay from slotMaps.slotValueMeta; keep label parsing as fallback.
   */
  function parseSlotRow(optionValue, label) {
    var parsed = parseSlotLabel(label);
    parsed.slotDateYmd = '';
    var maps = pickerCfg.slotMaps;
    var meta = maps && maps.slotValueMeta ? maps.slotValueMeta[optionValue] : null;
    if (!meta || typeof meta.minuteOfDay !== 'number') {
      return parsed;
    }
    if (typeof meta.dateYmd === 'string' && meta.dateYmd.trim()) {
      parsed.slotDateYmd = meta.dateYmd.trim();
    }
    var minuteOfDay = meta.minuteOfDay;
    var h24 = Math.floor(minuteOfDay / 60);
    var timeHhMm = minuteOfDayToHhMm(minuteOfDay);
    parsed.minuteOfDay = minuteOfDay;
    parsed.hourKey = String(h24);
    parsed.slideTitle = String(h24).padStart(2, '0') + ':00';
    parsed.timeLabel = timeHhMm;

    var category = parsed.category;
    if (category && category.trim()) {
      var catHmMeta = category.match(/^(\d{1,2}):(\d{2})$/);
      if (catHmMeta) {
        var catM = parseInt(catHmMeta[1], 10) * 60 + parseInt(catHmMeta[2], 10);
        parsed.displayLabel = catM === minuteOfDay ? timeHhMm : category + ' \u00b7 ' + timeHhMm;
      } else {
        parsed.displayLabel = category + ' \u00b7 ' + timeHhMm;
      }
    } else {
      parsed.displayLabel = timeHhMm;
    }

    return parsed;
  }

  function resolvedSelectedCalendarYmd() {
    var $selected = $dateSelect.find('option:selected');
    return (currentSelectedDateYmd || '').trim() ||
      resolveDateYmd(String($selected.val() || '').trim(), $selected.text());
  }

  function effectiveSiteNowMinutes() {
    var n = pickerCfg.siteNowMinutes;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
    if (typeof n === 'string' && String(n).trim() !== '') {
      var parsed = parseInt(n, 10);
      return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
  }

  /**
   * Hide slots that started earlier today using slot-local dateYmd (authoritative when present).
   */
  function isPastSlotForSelectedDate(parsed) {
    var todayYmd = String(pickerCfg.siteTodayYmd || '').trim();
    if (!todayYmd || parsed.minuteOfDay === null) return false;

    var nowM = effectiveSiteNowMinutes();
    if (!Number.isFinite(nowM)) return false;

    var slotDay = parsed.slotDateYmd ? String(parsed.slotDateYmd).trim() : '';
    var dayToCompare = slotDay || resolvedSelectedCalendarYmd();
    return !!dayToCompare && dayToCompare === todayYmd && parsed.minuteOfDay < nowM;
  }

  // ─── Date slider ─────────────────────────────────────────────────────────────

  function buildDateSlider() {
    var pills = [];
    $dateSelect.find('option').each(function () {
      var val = $(this).val(), label = $(this).text().trim();
      if (val) pills.push({ value: val, label: label });
    });

    if (!pills.length) {
      $dateFieldRow.after('<p class="kbm-no-dates">No upcoming dates available.</p>');
      return;
    }

    var initialDateValue = String($dateSelect.val() || '').trim();
    var initialDateLabel = $dateSelect.find('option:selected').text().trim();
    var defaultPill = pills[0];
    currentSelectedDateYmd = resolveDateYmd(initialDateValue, initialDateLabel) ||
      resolveDateYmd(defaultPill.value, defaultPill.label);
    currentSelectedDateLabel = initialDateLabel || defaultPill.label;

    // Group into pages of 4
    var pages = [], PAGE_SIZE = 4;
    for (var i = 0; i < pills.length; i += PAGE_SIZE) {
      pages.push(pills.slice(i, i + PAGE_SIZE));
    }

    var $wrapper = $('<div class="kbm-slider"></div>');
    var $label = $('<div class="kbm-slider__label">Select a date</div>');
    var $prev = makeArrow('prev');
    var $next = makeArrow('next');
    var $viewport = $('<div class="kbm-slot-viewport"></div>');
    var $track = $('<div class="kbm-slot-track"></div>');

    pages.forEach(function (page) {
      var $slide = $('<div class="kbm-slot-slide kbm-date-slide"></div>');
      page.forEach(function (pill) {
        var ymdForDay = resolveDateYmd(pill.value, pill.label);
        var dayName = ymdLocalNoonWeekday(ymdForDay) || new Date(pill.label).toLocaleDateString('en-US', { weekday: 'long' });
        var $pill = $('<button type="button" class="kbm-pill"><span class="kbm-pill__date">' + pill.label + '</span><span class="kbm-pill__day">' + dayName + '</span></button>');
        if (pill.value === initialDateValue || (!initialDateValue && pill === defaultPill)) {
          $pill.addClass('active');
        }
        $pill.on('click', function () {
          $track.find('.kbm-pill').removeClass('active');
          $pill.addClass('active');
          currentSelectedDateYmd = resolveDateYmd(pill.value, pill.label);
          currentSelectedDateLabel = pill.label;
          $dateSelect.val(pill.value).trigger('change');
          if (useCustomTimeSlots) {
            var $area = kbmSlotAreaEl();
            $area.show();
            showLoading($area);
          }
        });
        $slide.append($pill);
      });
      $track.append($slide);
    });

    $viewport.append($track);
    $wrapper.append($label, $prev, $viewport, $next);
    $dateFieldRow.after($wrapper);
    if (useCustomTimeSlots) {
      $wrapper.after('<div id="kbm-slot-area" style="display:none"></div>');
    } else {
      if ($slotFieldRow.length) {
        $slotFieldRow.insertAfter($wrapper).show();
      }
      $('<div id="kbm-slot-area" style="display:none"></div>').insertAfter(
        $slotFieldRow.length ? $slotFieldRow : $wrapper
      );
    }

    var goToSlide = makePager($viewport, $track, pages.length, $prev, $next);
    goToSlide(0);
  }

  // ─── Slot slider (paginated by hour) ─────────────────────────────────────────

  function buildSlotSlider() {
    if (!useCustomTimeSlots) {
      return;
    }
    var rows = [];
    $slotSelect.find('option').each(function () {
      var val = $(this).val(), label = $(this).text().trim();
      if (!val) return;
      rows.push({
        val: val,
        label: label,
        parsed: parseSlotRow(val, label),
        soldOut: label.toLowerCase().indexOf('sold out') !== -1
      });
    });

    rows = rows.filter(function (row) {
      return !isPastSlotForSelectedDate(row.parsed);
    });

    var allCats = Object.create(null);
    rows.forEach(function (r) {
      if (r.parsed.category) allCats[r.parsed.category] = true;
    });
    var multi = Object.keys(allCats).length > 1;

    var hourGroups = {};
    var hourOrder = [];

    rows.forEach(function (row) {
      var parsed = row.parsed;
      var gk = multi ? ((parsed.category || '_') + '\t' + parsed.hourKey) : parsed.hourKey;
      if (!hourGroups[gk]) {
        var slideTitle = parsed.slideTitle;
        if (multi && parsed.category) {
          slideTitle = parsed.category + ' \u00b7 ' + parsed.slideTitle;
        }
        hourGroups[gk] = { title: slideTitle, hourTitle: parsed.slideTitle, slots: [] };
        hourOrder.push(gk);
      }
      hourGroups[gk].slots.push({
        value: row.val,
        label: row.label,
        pillText: row.parsed.minuteOfDay !== null ? row.parsed.displayLabel : row.label,
        disabled: row.soldOut
      });
    });

    var $slotAreaMount = kbmSlotAreaEl();
    removeLoading($slotAreaMount);

    if (!hourOrder.length) {
      $slotAreaMount.html('<p class="kbm-no-slots">No upcoming time slots remain for this date.</p>');
      return;
    }

    var $wrapper = $('<div class="kbm-slot-slider"></div>');
    var $label = $('<div class="kbm-slider__label">Select a time</div>');
    var $prev = makeArrow('prev');
    var $next = makeArrow('next');
    var $hourNav = $('<div class="kbm-slot-hour-nav" aria-live="polite"></div>');
    var $prevHour = $('<button type="button" class="kbm-slot-hour-nav__hint kbm-slot-hour-nav__hint--prev"></button>');
    var $currentHour = $('<div class="kbm-slot-hour-nav__current"></div>');
    var $nextHour = $('<button type="button" class="kbm-slot-hour-nav__hint kbm-slot-hour-nav__hint--next"></button>');
    var $viewport = $('<div class="kbm-slot-viewport"></div>');
    var $track = $('<div class="kbm-slot-track"></div>');

    $hourNav.append($prevHour, $currentHour, $nextHour);

    hourOrder.forEach(function (groupKey) {
      var group = hourGroups[groupKey];
      var $slide = $('<div class="kbm-slot-slide"></div>');
      var $grid = $('<div class="kbm-slot-grid"></div>');
      $slide.append($grid);

      group.slots.forEach(function (slot) {
        var $pill = $('<button type="button" class="kbm-pill"></button>');
        $pill.text(slot.pillText);
        if (slot.disabled) $pill.addClass('disabled').prop('disabled', true).attr('title', 'Sold out');
        $pill.on('click', function () {
          $wrapper.find('.kbm-pill').removeClass('active');
          $pill.addClass('active');
          $slotSelect.val(slot.value).trigger('change');
        });
        $grid.append($pill);
      });

      $track.append($slide);
    });

    $viewport.append($track);
    $wrapper.append($label, $hourNav, $prev, $viewport, $next);
    $slotAreaMount.html('').append($wrapper);

    function hourTitleAt(index) {
      var key = hourOrder[index];
      return key && hourGroups[key] ? hourGroups[key].hourTitle : '';
    }

    var currentHourIndex = 0;

    function updateHourNav(index) {
      currentHourIndex = index;
      var prevTitle = hourTitleAt(index - 1);
      var currentTitle = hourTitleAt(index);
      var nextTitle = hourTitleAt(index + 1);

      $hourNav
        .removeClass('is-animating')
        .toggleClass('is-at-start', !prevTitle && !!nextTitle)
        .toggleClass('is-at-end', !!prevTitle && !nextTitle)
        .toggleClass('is-single-hour', !prevTitle && !nextTitle);
      void $hourNav[0].offsetWidth;
      $hourNav.addClass('is-animating');
      $prevHour
        .text(prevTitle ? '\u2039 ' + prevTitle : '')
        .prop('disabled', !prevTitle)
        .attr('aria-label', prevTitle ? 'Show ' + prevTitle + ' times' : 'No earlier hour')
        .toggleClass('is-hidden', !prevTitle);
      $currentHour.text(currentTitle || '');
      $nextHour
        .text(nextTitle ? nextTitle + ' \u203a' : '')
        .prop('disabled', !nextTitle)
        .attr('aria-label', nextTitle ? 'Show ' + nextTitle + ' times' : 'No later hour')
        .toggleClass('is-hidden', !nextTitle);
    }

    var goToSlide = makePager($viewport, $track, hourOrder.length, $prev, $next, updateHourNav);
    $prevHour.on('click', function () { goToSlide(currentHourIndex - 1); });
    $nextHour.on('click', function () { goToSlide(currentHourIndex + 1); });
    goToSlide(0);

  }

  // ─── Loading helpers ──────────────────────────────────────────────────────────

  function showLoading($target) {
    $target.html('<div class="kbm-slot-loading">Loading available times&hellip;</div>');
  }

  function removeLoading($target) {
    $target.find('.kbm-slot-loading').remove();
  }

  // ─── MutationObserver for slot population ────────────────────────────────────

  if (useCustomTimeSlots && $slotSelect.length) {
    var slotObserver = new MutationObserver(function (mutations) {
      if (mutations.some(function (m) { return m.addedNodes.length > 0; })) buildSlotSlider();
    });
    slotObserver.observe($slotSelect[0], { childList: true });
  }

  $dateSelect.on('change', function () {
    if (useCustomTimeSlots) {
      kbmSlotAreaEl().html('');
    }
  });

  // ─── Init ────────────────────────────────────────────────────────────────────

  $('div.quantity').before('<div class="kbm-qte__label">Tickets Number</div>');

  buildDateSlider();

  // Move availability below the slot area and reformat text when FooEvents updates it
  var $availability = $cartForm.find('#fooevents-checkout-attendee-info-val-trans').first();
  if ($availability.length) {
    var $slotMount = kbmSlotAreaEl();
    if ($slotMount.length) {
      $availability.insertAfter($slotMount);
    }

    new MutationObserver(function () {
      var text = $availability.text().trim();
      var match = text.match(/\d+/);
      if (match && text !== 'Only ' + match[0] + ' tickets left') {
        $availability.text('Only ' + match[0] + ' tickets left');
      }
    }).observe($availability[0], { childList: true, subtree: true, characterData: true });
  }
});
