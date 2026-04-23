/**
 * Reviews widget - drop into any doctor profile page.
 *
 * Usage:
 *   <div id="reviews-widget" data-slug="dr-foo-bar-1234"></div>
 *   <script src="/assets/js/reviews-widget.js" defer></script>
 */
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function stars(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }
  function fmt(d) { try { return new Date(d).toLocaleDateString(); } catch { return ''; } }

  async function load(container) {
    const slug = container.dataset.slug;
    if (!slug) { container.innerHTML = '<p>Missing slug</p>'; return; }
    container.innerHTML = '<p style="color:#6b6558">Loading reviews...</p>';

    let data;
    try {
      const r = await fetch('/api/reviews-public?slug=' + encodeURIComponent(slug));
      data = await r.json();
    } catch { data = { reviews: [], count: 0, avg: null }; }
    const reviews = data.reviews || [];

    const summary = `
      <div class="rw-summary" style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div style="font-size:32px;font-weight:700;font-family:Georgia,serif;color:#0b1a2f">${data.avg || '-'}</div>
        <div>
          <div style="color:#C8A45E;font-size:18px">${data.avg ? stars(Math.round(data.avg)) : stars(0)}</div>
          <div style="font-size:13px;color:#6b6558">${data.count || 0} review${data.count === 1 ? '' : 's'}</div>
        </div>
      </div>`;

    const list = reviews.map(rv => `
      <div class="rw-item" style="padding:14px 0;border-bottom:1px solid #e5e1d6">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong style="color:#0b1a2f">${esc(rv.reviewer_name)}</strong>
          <span style="color:#C8A45E">${stars(rv.rating)}</span>
        </div>
        <div style="font-size:12px;color:#6b6558;margin:2px 0 6px">${fmt(rv.created_at)}${rv.featured ? ' &middot; <span style="color:#8a6a34;font-weight:600">Featured</span>' : ''}${rv.verified_patient ? ' &middot; Verified patient' : ''}</div>
        ${rv.title ? `<div style="font-weight:600;margin-bottom:4px">${esc(rv.title)}</div>` : ''}
        ${rv.body ? `<div style="font-size:14px;color:#333;line-height:1.5">${esc(rv.body)}</div>` : ''}
      </div>`).join('') || '<p style="color:#6b6558">No reviews yet. Be the first to share your experience.</p>';

    const form = `
      <div class="rw-form" style="margin-top:24px;padding:20px;background:#faf8f3;border-radius:8px;border:1px solid #e5e1d6">
        <h3 style="margin:0 0 12px;font-family:'Playfair Display',serif">Write a Review</h3>
        <div id="rw-msg" style="margin-bottom:10px"></div>
        <div style="margin-bottom:10px">
          <label style="display:block;font-size:12px;color:#6b6558;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Your rating</label>
          <div id="rw-rating" style="font-size:28px;color:#C8A45E;cursor:pointer;user-select:none">
            ${[1,2,3,4,5].map(i => `<span data-v="${i}">☆</span>`).join(' ')}
          </div>
        </div>
        <input id="rw-name" placeholder="Your name" style="width:100%;padding:10px;margin-bottom:8px;border:1px solid #c8c0ae;border-radius:6px;box-sizing:border-box">
        <input id="rw-email" type="email" placeholder="Email (optional, never shown)" style="width:100%;padding:10px;margin-bottom:8px;border:1px solid #c8c0ae;border-radius:6px;box-sizing:border-box">
        <input id="rw-title" placeholder="Headline (optional)" style="width:100%;padding:10px;margin-bottom:8px;border:1px solid #c8c0ae;border-radius:6px;box-sizing:border-box">
        <textarea id="rw-body" placeholder="Share details of your visit..." style="width:100%;min-height:100px;padding:10px;margin-bottom:8px;border:1px solid #c8c0ae;border-radius:6px;box-sizing:border-box;font-family:inherit"></textarea>
        <button id="rw-submit" style="padding:10px 20px;background:#C8A45E;border:none;border-radius:6px;color:#0b1a2f;font-weight:600;cursor:pointer;font-size:14px">Submit Review</button>
        <p style="font-size:11px;color:#6b6558;margin:10px 0 0">Reviews are moderated before publishing. Please be honest and respectful.</p>
      </div>`;

    container.innerHTML = `
      <div class="rw-root">
        <h2 style="font-family:'Playfair Display',serif;color:#0b1a2f;margin:0 0 12px">Patient Reviews</h2>
        ${summary}
        <div class="rw-list">${list}</div>
        ${form}
      </div>`;

    // rating selector
    let rating = 0;
    const ratingEl = container.querySelector('#rw-rating');
    ratingEl.querySelectorAll('span').forEach(sp => {
      sp.addEventListener('click', () => {
        rating = parseInt(sp.dataset.v, 10);
        ratingEl.querySelectorAll('span').forEach(s => {
          s.textContent = parseInt(s.dataset.v, 10) <= rating ? '★' : '☆';
        });
      });
    });

    container.querySelector('#rw-submit').addEventListener('click', async () => {
      const msg = container.querySelector('#rw-msg');
      msg.innerHTML = '';
      const payload = {
        slug,
        rating,
        reviewer_name: container.querySelector('#rw-name').value.trim(),
        reviewer_email: container.querySelector('#rw-email').value.trim(),
        title: container.querySelector('#rw-title').value.trim(),
        body: container.querySelector('#rw-body').value.trim()
      };
      if (!payload.reviewer_name) { msg.innerHTML = '<span style="color:#c4432a">Name required</span>'; return; }
      if (!(rating >= 1 && rating <= 5)) { msg.innerHTML = '<span style="color:#c4432a">Please pick a star rating</span>'; return; }
      msg.innerHTML = '<span style="color:#6b6558">Submitting...</span>';
      try {
        const r = await fetch('/api/submit-review', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const d = await r.json();
        if (!r.ok) { msg.innerHTML = '<span style="color:#c4432a">' + esc(d.error || 'Failed') + '</span>'; return; }
        msg.innerHTML = '<span style="color:#1b7a2e">Thanks! Your review is pending moderation.</span>';
        container.querySelector('#rw-name').value = '';
        container.querySelector('#rw-email').value = '';
        container.querySelector('#rw-title').value = '';
        container.querySelector('#rw-body').value = '';
      } catch (e) { msg.innerHTML = '<span style="color:#c4432a">' + esc(e.message) + '</span>'; }
    });
  }

  function init() {
    document.querySelectorAll('#reviews-widget, .reviews-widget').forEach(load);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
