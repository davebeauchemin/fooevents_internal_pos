// "May 7, 2026" → "Wednesday, May 7, 2026"
function kbmFormatDate(str) {
  var date = new Date(str);
  if (isNaN(date)) return str;
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// "Regular (11:00 a.m.)" or legacy "Lun-Jeu - AM (11:00 a.m.)" → "Regular · 11:00 AM"
function kbmFormatSlot(str) {
  var m = str.match(/^(.*?)\s*\((\d{1,2}:\d{2})(?:\s*(a\.m\.|p\.m\.))?\)\s*$/i);
  if (!m) return str;
  var cat = m[1].trim();
  var time = m[2] + (m[3] ? ' ' + m[3].replace(/\./g, '').toUpperCase() : '');
  return cat ? cat + ' \u00b7 ' + time : time;
}

function kbmFormatCartItems() {
  document.querySelectorAll('.wc-block-components-product-details__date .wc-block-components-product-details__value').forEach(function (el) {
    var raw = el.getAttribute('data-raw') || el.textContent.trim();
    var formatted = kbmFormatDate(raw);
    if (el.textContent.trim() !== formatted) {
      el.setAttribute('data-raw', raw);
      el.textContent = formatted;
    }
  });

  document.querySelectorAll('.wc-block-components-product-details__slot .wc-block-components-product-details__value').forEach(function (el) {
    var raw = el.getAttribute('data-raw') || el.textContent.trim();
    var formatted = kbmFormatSlot(raw);
    if (el.textContent.trim() !== formatted) {
      el.setAttribute('data-raw', raw);
      el.textContent = formatted;
    }
  });
}

var debounceTimer;
var observer = new MutationObserver(function () {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(kbmFormatCartItems, 150);
});

observer.observe(document.body, { childList: true, subtree: true });
