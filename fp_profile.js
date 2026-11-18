/* fp_profile.js (B737 edition) - aircraft profile kept ON THE DEVICE, never in the repository.
   oei = the distance your company uses for "within 60 minutes of an adequate aerodrome with one engine inoperative", in NM.
   It is NOT set by default: take it from your own operations manual and enter it in the settings panel (sliders icon, top right).
   Until it is set the app draws no 1-hour rings and shows "1-hour distance not set" instead of a status. */
(function () {
  var v = null; try { v = parseFloat(localStorage.getItem('fp.oei_nm')); } catch (e) { }
  window.FPProfile = { type: 'B737', oei: v > 0 ? v : null,
    set: function (n) { n = parseFloat(n); try { if (n > 0) localStorage.setItem('fp.oei_nm', String(n)); else localStorage.removeItem('fp.oei_nm'); } catch (e) { } this.oei = n > 0 ? n : null; } };
  window.FPOEI = function () { return (window.FPProfile && window.FPProfile.oei) || 0; };
  document.addEventListener('DOMContentLoaded', function () {
    var i = document.getElementById('oei-nm'), b = document.getElementById('oei-save'); if (!i || !b) return;
    if (window.FPProfile.oei) i.value = window.FPProfile.oei;
    b.addEventListener('click', function () { window.FPProfile.set(i.value); b.textContent = window.FPProfile.oei ? 'Saved – reloading' : 'Cleared – reloading'; setTimeout(function () { location.reload(); }, 400); });
  });
})();
