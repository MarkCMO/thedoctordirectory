document.addEventListener('DOMContentLoaded', function() {
  // Modal handling
  var modalOverlay = document.getElementById('inquiry-modal');
  var modalTitle = document.getElementById('modal-title');
  var openBtns = document.querySelectorAll('[data-modal="inquiry"]');
  var travelBtns = document.querySelectorAll('[data-modal="travel"]');
  var closeBtns = document.querySelectorAll('.modal-close');

  function openModal(type) {
    if (!modalOverlay) return;
    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (modalTitle) modalTitle.textContent = type === 'travel' ? 'Request Travel Consultation' : 'Send Inquiry';
    var tf = document.getElementById('travel-fields');
    if (tf) tf.style.display = type === 'travel' ? 'block' : 'none';
  }
  function closeModal() {
    if (!modalOverlay) return;
    modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }
  openBtns.forEach(function(b){b.addEventListener('click',function(){openModal('inquiry')})});
  travelBtns.forEach(function(b){b.addEventListener('click',function(){openModal('travel')})});
  closeBtns.forEach(function(b){b.addEventListener('click',closeModal)});
  if (modalOverlay) modalOverlay.addEventListener('click',function(e){if(e.target===modalOverlay)closeModal()});

  // Inquiry form
  var form = document.getElementById('inquiry-form');
  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var body = document.querySelector('.modal-body');
      if (body) body.innerHTML = '<div style="text-align:center;padding:40px 20px;"><div style="width:64px;height:64px;background:var(--green-light);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg></div><h4 style="font-family:\'Playfair Display\',serif;font-size:22px;margin-bottom:10px;">Inquiry Submitted</h4><p style="font-size:15px;color:var(--text-secondary);line-height:1.6;">Our concierge team will respond within 24 hours.</p></div>';
    });
  }

  // Search form redirect (on pages other than find-a-doctor)
  var searchForm = document.getElementById('search-form');
  if (searchForm) {
    function doRedirect() {
      var params = new URLSearchParams();
      var sp = document.getElementById('search-specialty');
      var cn = document.getElementById('search-condition');
      var st = document.getElementById('search-state');
      if (sp && sp.value) params.set('specialty', sp.value);
      if (cn && cn.value) params.set('condition', cn.value);
      if (st && st.value) params.set('state', st.value);
      window.location.href = '/find-a-doctor' + (params.toString() ? '?' + params.toString() : '');
    }
    searchForm.addEventListener('submit', function(e) { e.preventDefault(); doRedirect(); });
    ['search-specialty','search-condition','search-state'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', doRedirect);
    });
  }

  // Mobile menu
  var mb = document.querySelector('.mobile-menu-btn');
  var nl = document.querySelector('.nav-links');
  if (mb && nl) mb.addEventListener('click', function() { nl.classList.toggle('mobile-open'); });
});
