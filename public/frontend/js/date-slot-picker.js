jQuery(document).ready(function ($) {
  // Set fipos_enable_custom_time_slot_picker to true in PHP (filter) to use pill grid; default is native <select>.
  var useCustomTimeSlots = !!(window.fiposDateSlotPicker && window.fiposDateSlotPicker.customTimeSlots);

  var DATE_SELECT_ID = '#fooevents_bookings_date_val__trans';
  var SLOT_SELECT_ID = '#fooevents_bookings_slot_val__trans';
  var DATE_FIELD_ID = '#fooevents_bookings_date_val__trans_field';
  var SLOT_FIELD_ID = '#fooevents_bookings_slot_val__trans_field';

  var $dateSelect = $(DATE_SELECT_ID);
  var $slotSelect = $(SLOT_SELECT_ID);

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

  // ─── Date slider ─────────────────────────────────────────────────────────────

  function buildDateSlider() {
    var pills = [];
    $dateSelect.find('option').each(function () {
      var val = $(this).val(), label = $(this).text().trim();
      if (val) pills.push({ value: val, label: label });
    });

    if (!pills.length) {
      $(DATE_FIELD_ID).after('<p class="kbm-no-dates">No upcoming dates available.</p>');
      return;
    }

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
        var dayName = new Date(pill.label).toLocaleDateString('en-US', { weekday: 'long' });
        var $pill = $('<button type="button" class="kbm-pill"><span class="kbm-pill__date">' + pill.label + '</span><span class="kbm-pill__day">' + dayName + '</span></button>');
        $pill.on('click', function () {
          $track.find('.kbm-pill').removeClass('active');
          $pill.addClass('active');
          $dateSelect.val(pill.value).trigger('change');
          if (useCustomTimeSlots) {
            $('#kbm-slot-area').show();
            showLoading($('#kbm-slot-area'));
          }
        });
        $slide.append($pill);
      });
      $track.append($slide);
    });

    $viewport.append($track);
    $wrapper.append($label, $prev, $viewport, $next);
    $(DATE_FIELD_ID).after($wrapper).hide();
    if (useCustomTimeSlots) {
      $wrapper.after('<div id="kbm-slot-area" style="display:none"></div>');
      $(SLOT_FIELD_ID).hide();
    } else {
      $(SLOT_FIELD_ID).insertAfter($wrapper).show();
      $('<div id="kbm-slot-area" style="display:none"></div>').insertAfter($(SLOT_FIELD_ID));
    }

    var goToSlide = makePager($viewport, $track, pages.length, $prev, $next);
    goToSlide(0);
  }

  // ─── Slot slider (paginated by hour) ─────────────────────────────────────────

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
      h24 = h;
    }
    var isPm = h24 >= 12 && h24 < 24;
    var apLabel = isPm ? 'PM' : 'AM';
    var h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    var hourKey = String(h24);
    var category = label.replace(/\s*\([^)]*\)\s*$/, '').trim();
    var mm = m[2];
    var minuteOfDay = (h24 * 60) + parseInt(mm, 10);
    var timeNice = h12 + ':' + mm + ' ' + apLabel;
    var slideTitle = h12 + ' ' + apLabel;

    // Pill text: "Category · 11:00 AM". If the label is time-only (e.g. 11:00 (11:00 a.m.)), show time once.
    var displayLabel;
    var catHm = category.match(/^(\d{1,2}):(\d{2})$/);
    if (catHm) {
      var catM = parseInt(catHm[1], 10) * 60 + parseInt(catHm[2], 10);
      var slotM = h24 * 60 + parseInt(mm, 10);
      if (catM === slotM) {
        displayLabel = timeNice;
      } else {
        displayLabel = category + ' \u00b7 ' + timeNice;
      }
    } else if (category) {
      displayLabel = category + ' \u00b7 ' + timeNice;
    } else {
      displayLabel = timeNice;
    }

    return {
      hourKey: hourKey,
      timeLabel: m[1] + ':' + m[2],
      slideTitle: slideTitle,
      category: category,
      displayLabel: displayLabel,
      minuteOfDay: minuteOfDay
    };
  }

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

  function selectedDateYmd() {
    var $selected = $dateSelect.find('option:selected');
    return dateLikeToYmd($selected.val()) || dateLikeToYmd($selected.text());
  }

  function isPastSlotForSelectedDate(parsed) {
    var cfg = window.fiposDateSlotPicker || {};
    if (!cfg.siteTodayYmd || typeof cfg.siteNowMinutes !== 'number' || parsed.minuteOfDay === null) {
      return false;
    }
    return selectedDateYmd() === cfg.siteTodayYmd && parsed.minuteOfDay < cfg.siteNowMinutes;
  }

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
        parsed: parseSlotLabel(label),
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
      // Pill text = raw FooEvents option label (no displayLabel / time reformatting).
      hourGroups[gk].slots.push({ value: row.val, label: row.label, disabled: row.soldOut });
    });

    removeLoading($('#kbm-slot-area'));

    if (!hourOrder.length) {
      $('#kbm-slot-area').html('<p class="kbm-no-slots">No upcoming time slots remain for this date.</p>');
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
        var $pill = $('<button type="button" class="kbm-pill">' + slot.label + '</button>');
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
    $('#kbm-slot-area').html('').append($wrapper);
    $(SLOT_FIELD_ID).hide();

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
      $('#kbm-slot-area').html('');
    }
  });

  // ─── Init ────────────────────────────────────────────────────────────────────

  $('div.quantity').before('<div class="kbm-qte__label">Tickets Number</div>');

  buildDateSlider();

  // Move availability below the slot area and reformat text when FooEvents updates it
  var $availability = $('#fooevents-checkout-attendee-info-val-trans');
  if ($availability.length) {
    $availability.insertAfter('#kbm-slot-area');

    new MutationObserver(function () {
      var text = $availability.text().trim();
      var match = text.match(/\d+/);
      if (match && text !== 'Only ' + match[0] + ' tickets left') {
        $availability.text('Only ' + match[0] + ' tickets left');
      }
    }).observe($availability[0], { childList: true, subtree: true, characterData: true });
  }
});
