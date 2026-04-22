document.addEventListener('DOMContentLoaded', function() {
  // Modal handling
  var modalOverlay = document.getElementById('inquiry-modal');
  var modalTitle = document.getElementById('modal-title');
  var openBtns = document.querySelectorAll('[data-modal="inquiry"]');
  var travelBtns = document.querySelectorAll('[data-modal="travel"]');
  var closeBtns = document.querySelectorAll('.modal-close');
  var currentType = 'inquiry';

  function openModal(type) {
    if (!modalOverlay) return;
    currentType = type === 'travel' ? 'travel' : 'inquiry';
    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (modalTitle) modalTitle.textContent = currentType === 'travel' ? 'Request Travel Consultation' : 'Send Inquiry';
    var tf = document.getElementById('travel-fields');
    if (tf) tf.style.display = currentType === 'travel' ? 'block' : 'none';
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

  // Extract slug from URL path: /doctors/dr-xxx-1234
  function getSlug() {
    var m = location.pathname.match(/\/doctors\/([^\/\.]+)/);
    return m ? m[1] : '';
  }

  // Inquiry form - real submission to /api/facility-lead
  var form = document.getElementById('inquiry-form');
  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var inputs = form.querySelectorAll('input, textarea');
      // Fields by order: 0=name, 1=email, 2=phone, 3=location(travel), 4=dates(travel), 5=condition OR 3=condition(non-travel)
      var name = (inputs[0] && inputs[0].value || '').trim();
      var email = (inputs[1] && inputs[1].value || '').trim();
      var phone = (inputs[2] && inputs[2].value || '').trim();
      var location = '', preferredDates = '', message = '';
      if (currentType === 'travel') {
        location = (inputs[3] && inputs[3].value || '').trim();
        preferredDates = (inputs[4] && inputs[4].value || '').trim();
        message = (inputs[5] && inputs[5].value || '').trim();
      } else {
        // Travel fields hidden but still in DOM; textarea is last input
        var ta = form.querySelector('textarea');
        message = (ta && ta.value || '').trim();
      }

      var slug = getSlug();
      var submitBtn = form.querySelector('button[type="submit"], .form-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending...'; }

      if (!slug) {
        alert('Could not identify this doctor. Please refresh and try again.');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Inquiry'; }
        return;
      }
      if (!name || !email || !message) {
        alert('Name, email, and condition/reason are required.');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Inquiry'; }
        return;
      }

      fetch('/api/facility-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: slug,
          name: name,
          email: email,
          phone: phone,
          condition: currentType === 'travel' ? '' : message.slice(0, 200),
          location: location,
          preferredDates: preferredDates,
          message: message,
          inquiryType: currentType === 'travel' ? 'travel' : 'inquiry'
        })
      }).then(function(r){
        return r.json().then(function(data){ return { ok: r.ok, status: r.status, data: data }; });
      }).then(function(res){
        var body = document.querySelector('.modal-body');
        if (res.ok) {
          if (body) body.innerHTML = '<div style="text-align:center;padding:40px 20px;"><div style="width:64px;height:64px;background:var(--green-light,#d1f0d8);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--green,#1b7a2e)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg></div><h4 style="font-family:\'Playfair Display\',serif;font-size:22px;margin-bottom:10px;">Inquiry Submitted</h4><p style="font-size:15px;color:var(--text-secondary,#6b6558);line-height:1.6;">Our concierge team will respond within 24 hours. Check your email for confirmation.</p></div>';
        } else {
          var err = (res.data && res.data.error) || 'Submission failed. Please try again.';
          alert(err);
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Inquiry'; }
        }
      }).catch(function(err){
        alert('Network error. Please try again.');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Inquiry'; }
      });
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

  // Inject "Claim Your Listing" CTA on doctor profile pages (for unclaimed listings)
  (function injectClaimCta() {
    var slug = getSlug();
    if (!slug) return;
    var actions = document.querySelector('.profile-actions');
    if (!actions) return;
    // Check claim status via public lookup
    fetch('/api/facility-lookup?slug=' + encodeURIComponent(slug))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){
        if (!data || data.claimed) return;
        var banner = document.createElement('div');
        banner.style.cssText = 'margin:16px 0;padding:12px 16px;background:#faf8f3;border-left:3px solid #C8A45E;border-radius:4px;font-size:14px;color:#4a453a;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap';
        banner.innerHTML = '<span><strong style="color:#0b1a2f">Is this you?</strong> Claim this profile to manage leads, edit info, and respond to inquiries.</span>' +
                           '<a href="/claim?slug=' + encodeURIComponent(slug) + '" style="background:#C8A45E;color:#0b1a2f;padding:8px 14px;border-radius:4px;text-decoration:none;font-weight:600;font-size:13px;white-space:nowrap">Claim Listing</a>';
        actions.parentNode.insertBefore(banner, actions.nextSibling);
      })
      .catch(function(){});
  })();
});
