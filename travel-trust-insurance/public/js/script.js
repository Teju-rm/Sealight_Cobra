/**
 * TravelTrust Insurance — Frontend Scripts
 */

function displayLoginErrorMessage(panel, message) {
  let errorBox = panel.querySelector('.login-error');

  if (!errorBox) {
    errorBox = document.createElement('div');
    errorBox.className = 'login-error';

    const icon = document.createElement('i');
    icon.className = 'fas fa-exclamation-circle';
    errorBox.appendChild(icon);

    const heading = panel.querySelector('.login-heading');
    heading.insertAdjacentElement('afterend', errorBox);
  }

  const icon = errorBox.querySelector('i');
  errorBox.textContent = '';
  if (icon) {
    errorBox.appendChild(icon);
  }
  errorBox.appendChild(document.createTextNode(message));
  errorBox.hidden = false;
}

async function sendLoginRequest(form, payload, fallbackError) {
  const res = await fetch(form.action, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || fallbackError);
  }

  return data;
}

function clearStaleNavigationMarkers(navigationLinks) {
  for (const link of navigationLinks) {
    link.removeAttribute('aria-current');
  }
}

function normalizeNavigationPath(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function markCurrentNavigationLink() {
  const currentPath = normalizeNavigationPath(window.location.pathname);
  const navigationLinks = document.querySelectorAll('.nav-links a');

  clearStaleNavigationMarkers(navigationLinks);

  for (const link of navigationLinks) {
    if (normalizeNavigationPath(link.getAttribute('href') || '') === currentPath) {
      link.setAttribute('aria-current', 'page');
    }
  }
}

async function signInAdministrator(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const panel = document.getElementById('admin-login-panel');

  try {
    const data = await sendLoginRequest(
      form,
      {
        username: new FormData(form).get('username'),
        password: new FormData(form).get('password')
      },
      'Invalid username or password'
    );

    window.location.href = data.redirect || '/admin/claims';
  } catch (err) {
    displayLoginErrorMessage(panel, err.message || 'Invalid username or password');
  }
}

async function signInPolicyholder(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const panel = document.getElementById('user-login-panel');
  const formData = new FormData(form);

  try {
    const data = await sendLoginRequest(form, {
      full_name: formData.get('full_name'),
      policy_number: formData.get('policy_number')
    }, 'No claim found for that name and policy number');

    window.location.href = data.redirect || '/my-claims';
  } catch (err) {
    displayLoginErrorMessage(panel, err.message || 'No claim found for that name and policy number');
  }
}

window.signInAdministrator = signInAdministrator;
window.signInPolicyholder = signInPolicyholder;

const initializePageInteractions = function initializePageInteractions() {

  markCurrentNavigationLink();

  // ==========================================
  // MEGA MENU DROPDOWN TOGGLE
  // ==========================================
  const backdrop = document.createElement('div');
  backdrop.className = 'mega-menu-backdrop';
  document.body.appendChild(backdrop);

  let activeMegaMenu = null;

  function showMegaNavigationMenu(menuEl) {
    // Close any previously open mega menu
    if (activeMegaMenu) {
      activeMegaMenu.classList.remove('open');
    }
    menuEl.classList.add('open');
    backdrop.classList.add('open');
    activeMegaMenu = menuEl;
  }

  function hideMegaNavigationMenu() {
    if (activeMegaMenu) {
      activeMegaMenu.classList.remove('open');
      activeMegaMenu = null;
    }
    backdrop.classList.remove('open');
  }

  // Wire up all mega triggers
  const connectMegaNavigationButton = (trigger) => {
    const menu = trigger.parentElement.querySelector('.mega-menu');
    if (!menu) return;

    const toggleMegaNavigationMenu = function toggleMegaNavigationMenu(e) {
      e.preventDefault();
      if (menu.classList.contains('open')) {
        hideMegaNavigationMenu();
      } else {
        showMegaNavigationMenu(menu);
      }
    };

    trigger.addEventListener('click', toggleMegaNavigationMenu);

    // Close when a mega link inside this menu is clicked
    const connectMegaNavigationLink = (link) => {
      const closeMegaNavigationAfterLinkSelection = function closeMegaNavigationAfterLinkSelection() {
        hideMegaNavigationMenu();
      };

      link.addEventListener('click', closeMegaNavigationAfterLinkSelection);
    };

    menu.querySelectorAll('.mega-links a').forEach(connectMegaNavigationLink);
  };

  document.querySelectorAll('.mega-trigger').forEach(connectMegaNavigationButton);

  // Close on backdrop click
  const closeMegaNavigationWhenBackdropClicked = function closeMegaNavigationWhenBackdropClicked() {
    hideMegaNavigationMenu();
  };

  backdrop.addEventListener('click', closeMegaNavigationWhenBackdropClicked);

  // Close on Escape key
  const closeMegaNavigationWhenEscapePressed = function closeMegaNavigationWhenEscapePressed(e) {
    if (e.key === 'Escape' && activeMegaMenu) {
      hideMegaNavigationMenu();
    }
  };

  document.addEventListener('keydown', closeMegaNavigationWhenEscapePressed);

  // ==========================================
  // MOBILE TOGGLE
  // ==========================================
  const mobileToggle = document.querySelector('.mobile-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (mobileToggle && navLinks) {
    const toggleMobileNavigation = function toggleMobileNavigation() {
      if (navLinks.classList.contains('mobile-open')) {
        navLinks.classList.remove('mobile-open');
        navLinks.style.display = 'none';
      } else {
        navLinks.classList.add('mobile-open');
        navLinks.style.display = 'flex';
        navLinks.style.flexDirection = 'column';
        navLinks.style.position = 'absolute';
        navLinks.style.top = '64px';
        navLinks.style.left = '0';
        navLinks.style.width = '100%';
        navLinks.style.background = '#fff';
        navLinks.style.padding = '10px 0';
        navLinks.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
        navLinks.style.zIndex = '999';
        navLinks.style.borderBottom = '2px solid #C8102E';
      }
    };

    mobileToggle.addEventListener('click', toggleMobileNavigation);

    const adaptNavigationToScreenSize = function adaptNavigationToScreenSize() {
      if (window.innerWidth > 768) {
        navLinks.classList.remove('mobile-open');
        navLinks.style.display = 'flex';
        navLinks.style.flexDirection = 'row';
        navLinks.style.position = 'static';
        navLinks.style.width = 'auto';
        navLinks.style.background = 'transparent';
        navLinks.style.padding = '0';
        navLinks.style.boxShadow = 'none';
        navLinks.style.borderBottom = 'none';
      } else if (!navLinks.classList.contains('mobile-open')) {
        navLinks.style.display = 'none';
      }
    };

    window.addEventListener('resize', adaptNavigationToScreenSize);
  }

  // ==========================================
  // HERO QUOTE FORM (Homepage compact form)
  // ==========================================
  const showHeroQuote = document.getElementById('showHeroQuote');
  const heroQuoteBox = document.getElementById('heroQuoteBox');
  const heroForm = document.getElementById('heroQuoteForm');
  const heroResponse = document.getElementById('heroQuoteResponse');

  if (showHeroQuote && heroQuoteBox) {
    const openQuickQuoteForm = function openQuickQuoteForm(e) {
      e.preventDefault();
      heroQuoteBox.hidden = false;
      heroQuoteBox.classList.add('is-visible');
      heroQuoteBox.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const firstField = heroQuoteBox.querySelector('input, select, textarea, button');
      if (firstField) {
        firstField.focus({ preventScroll: true });
      }
    };

    showHeroQuote.addEventListener('click', openQuickQuoteForm);
  }

  if (heroForm) {
    const submitQuickQuoteRequest = async function submitQuickQuoteRequest(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const payload = {
        zipCode: formData.get('zipCode'),
        insuranceType: formData.get('insuranceType')
      };

      if (!payload.zipCode || payload.zipCode.length !== 5) {
        displayQuickQuoteResponse('Please enter a valid 5-digit ZIP code.', 'error');
        return;
      }
      if (!payload.insuranceType) {
        displayQuickQuoteResponse('Please select an insurance type.', 'error');
        return;
      }

      const btn = this.querySelector('.btn');
      const origText = btn.textContent;
      btn.textContent = 'Submitting...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: 'Quick Quote',
            zipCode: payload.zipCode,
            insuranceType: payload.insuranceType,
            email: 'quick@quote.com',
            phone: '000-000-0000'
          })
        });
        const data = await res.json();
        if (res.ok) {
          displayQuickQuoteResponse('Quote request started! Our team will contact you shortly.', 'success');
          this.reset();
        } else {
          displayQuickQuoteResponse(data.error || 'Please try again.', 'error');
        }
      } catch (err) {
        displayQuickQuoteResponse('Network error. Please try again.', 'error');
      } finally {
        btn.textContent = origText;
        btn.disabled = false;
      }
    };

    heroForm.addEventListener('submit', submitQuickQuoteRequest);

    function displayQuickQuoteResponse(msg, type) {
      heroResponse.textContent = msg;
      heroResponse.className = 'quote-response-mini ' + type;
      heroResponse.style.display = 'block';
      function hideQuickQuoteResponse() { heroResponse.style.display = 'none'; }
      setTimeout(hideQuickQuoteResponse, 5000);
    }
  }

  // ==========================================
  // SUSTAINABILITY DRIVER DETAILS
  // ==========================================
  const connectSustainabilityDetailsToggle = (driver) => {
    const detail = driver.querySelector('p');
    if (!detail) return;

    const toggleSustainabilityDetails = function toggleSustainabilityDetails(e) {
      e.preventDefault();
      const isOpen = driver.getAttribute('aria-expanded') === 'true';
      detail.hidden = isOpen;
      driver.setAttribute('aria-expanded', String(!isOpen));
    };

    driver.addEventListener('click', toggleSustainabilityDetails);
  };

  document.querySelectorAll('.sustainability-driver-toggle').forEach(connectSustainabilityDetailsToggle);

  // ==========================================
  // RESOURCE CARD READ MORE
  // ==========================================
  const connectResourceExpansionLink = (link) => {
    const resourceBody = link.closest('.resource-body');
    const moreContent = resourceBody ? resourceBody.querySelector('.resource-more') : null;
    if (!moreContent) return;

    const toggleResourceDetails = function toggleResourceDetails(e) {
      e.preventDefault();
      const isExpanded = !moreContent.hidden;

      moreContent.hidden = isExpanded;
      link.innerHTML = isExpanded
        ? 'Read More <i class="fas fa-arrow-right"></i>'
        : 'Show Less <i class="fas fa-arrow-up"></i>';
    };

    link.addEventListener('click', toggleResourceDetails);
  };

  document.querySelectorAll('.resource-read-more').forEach(connectResourceExpansionLink);

  // ==========================================
  // QUOTE PAGE FORM (Full form)
  // ==========================================
  const quotePageForm = document.getElementById('quotePageForm');
  const quotePageResponse = document.getElementById('quotePageResponse');

  if (quotePageForm) {
    const submitDetailedQuoteRequest = async function submitDetailedQuoteRequest(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const payload = {
        fullName: formData.get('fullName'),
        zipCode: formData.get('zipCode'),
        insuranceType: formData.get('insuranceType'),
        email: formData.get('email'),
        phone: formData.get('phone')
      };

      const btn = this.querySelector('.btn');
      const origText = btn.textContent;
      btn.textContent = 'Submitting...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
          displayDetailedQuoteResponse(
            `<strong>${data.message}</strong><br>Reference ID: ${data.lead.id}<br>We'll be in touch at ${payload.email} or ${payload.phone}.`,
            'success'
          );
          quotePageForm.reset();
        } else {
          displayDetailedQuoteResponse(data.error || 'Please check your information and try again.', 'error');
        }
      } catch (err) {
        displayDetailedQuoteResponse('Network error. Please try again.', 'error');
      } finally {
        btn.textContent = origText;
        btn.disabled = false;
      }
    };

    quotePageForm.addEventListener('submit', submitDetailedQuoteRequest);

    function displayDetailedQuoteResponse(html, type) {
      quotePageResponse.innerHTML = html;
      quotePageResponse.className = 'response-area ' + type;
      quotePageResponse.style.display = 'block';
    }
  }

  // ==========================================
  // CONTACT FORM
  // ==========================================
  const contactForm = document.getElementById('contactForm');
  const contactResponse = document.getElementById('contactResponse');

  if (contactForm) {
    const submitContactRequest = async function submitContactRequest(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const payload = {
        name: formData.get('name'),
        email: formData.get('email'),
        message: formData.get('message')
      };

      const btn = this.querySelector('.btn');
      const origText = btn.textContent;
      btn.textContent = 'Sending...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
          displayContactRequestResponse(
            `<strong>${data.message}</strong><br>Reference ID: ${data.contact.id}`,
            'success'
          );
          contactForm.reset();
        } else {
          displayContactRequestResponse(data.error || 'Please try again.', 'error');
        }
      } catch (err) {
        displayContactRequestResponse('Network error. Please try again.', 'error');
      } finally {
        btn.textContent = origText;
        btn.disabled = false;
      }
    };

    contactForm.addEventListener('submit', submitContactRequest);

    function displayContactRequestResponse(html, type) {
      contactResponse.innerHTML = html;
      contactResponse.className = 'response-area ' + type;
      contactResponse.style.display = 'block';
    }
  }

  // ==========================================
  // CLAIM FORM
  // ==========================================
  const claimForm = document.getElementById('claimForm');
  const claimResponse = document.getElementById('claimResponse');

  if (claimForm) {
    const submitInsuranceClaim = async function submitInsuranceClaim(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const payload = {
        fullName: formData.get('fullName'),
        policyNumber: formData.get('policyNumber'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        incidentDate: formData.get('incidentDate'),
        claimType: formData.get('claimType'),
        description: formData.get('description')
      };

      const btn = this.querySelector('.btn');
      const origText = btn.textContent;
      btn.textContent = 'Submitting...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/claims', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
          displayClaimSubmissionResponse(
            `<strong>${data.message}</strong><br>Claim ID: ${data.claim.id}<br>We'll be in touch at ${payload.email} within 24 hours.`,
            'success'
          );
          claimForm.reset();
        } else {
          displayClaimSubmissionResponse(data.error || 'Please check your information and try again.', 'error');
        }
      } catch (err) {
        displayClaimSubmissionResponse('Network error. Please try again.', 'error');
      } finally {
        btn.textContent = origText;
        btn.disabled = false;
      }
    };

    claimForm.addEventListener('submit', submitInsuranceClaim);

    function displayClaimSubmissionResponse(html, type) {
      claimResponse.innerHTML = html;
      claimResponse.className = 'response-area ' + type;
      claimResponse.style.display = 'block';
    }
  }

  // ==========================================
  // CLAIM STATUS LOOKUP
  // ==========================================
  const claimStatusForm = document.getElementById('claimStatusForm');
  const claimStatusResponse = document.getElementById('claimStatusResponse');

  if (claimStatusForm) {
    const lookUpClaimStatus = async function lookUpClaimStatus(e) {
      e.preventDefault();
      const formData = new FormData(this);
      const claimId = formData.get('claimId').trim();
      const policyNumber = formData.get('policyNumber').trim();

      if (!claimId || !policyNumber) {
        displayClaimStatusResponse('Please enter both Claim ID and Policy Number.', 'error');
        return;
      }

      const btn = this.querySelector('.btn');
      const origText = btn.textContent;
      btn.textContent = 'Looking up...';
      btn.disabled = true;

      try {
        const res = await fetch(`/api/claims/lookup?claimId=${encodeURIComponent(claimId)}&policyNumber=${encodeURIComponent(policyNumber)}`);
        const data = await res.json();
        if (res.ok) {
          const formattedDate = new Date(data.timestamp).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
          });
          const statusBadge = data.status === 'Submitted' ? '🕐' : data.status === 'In Review' ? '🔄' : data.status === 'Approved' ? '✅' : '📋';
          displayClaimStatusResponse(
            `<div style="border: 1px solid #a5d6a7; border-radius: 8px; padding: 16px; background: #e8f5e9;">
              <h3 style="color: #2e7d32; margin-bottom: 12px;">${statusBadge} ${data.status}</h3>
              <table style="width:100%; border-collapse: collapse; font-size: 14px;">
                <tr><td style="padding: 6px 8px; font-weight: 600; color: #333; width: 120px;">Claim ID:</td><td style="padding: 6px 8px; color: #555;">${data.id}</td></tr>
                <tr><td style="padding: 6px 8px; font-weight: 600; color: #333;">Name:</td><td style="padding: 6px 8px; color: #555;">${data.fullName}</td></tr>
                <tr><td style="padding: 6px 8px; font-weight: 600; color: #333;">Policy:</td><td style="padding: 6px 8px; color: #555;">${data.policyNumber}</td></tr>
                <tr><td style="padding: 6px 8px; font-weight: 600; color: #333;">Claim Type:</td><td style="padding: 6px 8px; color: #555;">${data.claimType || 'N/A'}</td></tr>
                <tr><td style="padding: 6px 8px; font-weight: 600; color: #333;">Incident Date:</td><td style="padding: 6px 8px; color: #555;">${data.incidentDate || 'N/A'}</td></tr>
                <tr><td style="padding: 6px 8px; font-weight: 600; color: #333;">Submitted:</td><td style="padding: 6px 8px; color: #555;">${formattedDate}</td></tr>
              </table>
              <p style="margin-top: 10px; font-size: 13px; color: #666; border-top: 1px solid #c8e6c9; padding-top: 10px;"><strong>Description:</strong> ${data.description}</p>
            </div>`,
            'success'
          );
        } else {
          displayClaimStatusResponse(data.error || 'No claim found. Please check your Claim ID and Policy Number.', 'error');
        }
      } catch (err) {
        displayClaimStatusResponse('Network error. Please try again.', 'error');
      } finally {
        btn.textContent = origText;
        btn.disabled = false;
      }
    };

    claimStatusForm.addEventListener('submit', lookUpClaimStatus);

    function displayClaimStatusResponse(html, type) {
      claimStatusResponse.innerHTML = html;
      claimStatusResponse.className = 'response-area ' + type;
      claimStatusResponse.style.display = 'block';
    }
  }

};

document.addEventListener('DOMContentLoaded', initializePageInteractions);
