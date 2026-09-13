// Mailflux Client
let currentAccount = null;
let messages = [];
let activeMessageId = null;
let countdownInterval = null;
let currentActiveDomain = '';

// DOM Elements
const loggedOutButtons = document.getElementById('loggedOutButtons');
const navSignInBtn = document.getElementById('navSignInBtn');
const navSignUpBtn = document.getElementById('navSignUpBtn');

const profileContainer = document.getElementById('profileContainer');
const profileBtn = document.getElementById('profileBtn');
const profileDropdown = document.getElementById('profileDropdown');
const navAvatar = document.getElementById('navAvatar');
const navUsername = document.getElementById('navUsername');

// Dropdown Elements
const dropdownAvatar = document.getElementById('dropdownAvatar');
const dropdownEmail = document.getElementById('dropdownEmail');
const dropdownCopyEmailBtn = document.getElementById('dropdownCopyEmailBtn');
const dropdownCopyEmailText = document.getElementById('dropdownCopyEmailText');
const dropdownPasswordText = document.getElementById('dropdownPasswordText');
const dropdownTogglePassBtn = document.getElementById('dropdownTogglePassBtn');
const dropdownCopyPassBtn = document.getElementById('dropdownCopyPassBtn');
const savedCountBadge = document.getElementById('savedCountBadge');
const dropdownRecentList = document.getElementById('dropdownRecentList');
const dropdownCreateNewBtn = document.getElementById('dropdownCreateNewBtn');
const dropdownLoginOtherBtn = document.getElementById('dropdownLoginOtherBtn');
const dropdownSignOutBtn = document.getElementById('dropdownSignOutBtn');


// Main Views
const mandatoryAuthView = document.getElementById('mandatoryAuthView');
const inboxWorkspace = document.getElementById('inboxWorkspace');

// Landing Auth Forms
const tabSwitchCreate = document.getElementById('tabSwitchCreate');
const tabSwitchLogin = document.getElementById('tabSwitchLogin');
const landingCreateForm = document.getElementById('landingCreateForm');
const landingLoginForm = document.getElementById('landingLoginForm');
const regUsername = document.getElementById('regUsername');
const regDomainSelect = document.getElementById('regDomainSelect');
const regPassword = document.getElementById('regPassword');
const toggleRegPassBtn = document.getElementById('toggleRegPassBtn');
const btnSubmitCreate = document.getElementById('btnSubmitCreate');

const loginAddress = document.getElementById('loginAddress');
const loginPass = document.getElementById('loginPass');
const toggleLoginPassBtn = document.getElementById('toggleLoginPassBtn');
const btnSubmitLogin = document.getElementById('btnSubmitLogin');

const landingRecentSection = document.getElementById('landingRecentSection');
const landingRecentChips = document.getElementById('landingRecentChips');
const btnLandingClearRecent = document.getElementById('btnLandingClearRecent');

// Workspace Message List Elements
const unreadBadge = document.getElementById('unreadBadge');
const manualRefreshBtn = document.getElementById('manualRefreshBtn');
const manualRefreshIcon = document.getElementById('manualRefreshIcon');
const filterMessagesInput = document.getElementById('filterMessagesInput');
const messagesContainer = document.getElementById('messagesContainer');

// Reader Elements
const readerPlaceholder = document.getElementById('readerPlaceholder');

const readerPane = document.getElementById('readerPane');
const readerSubject = document.getElementById('readerSubject');
const btnDeleteMessage = document.getElementById('btnDeleteMessage');
const senderAvatar = document.getElementById('senderAvatar');
const senderName = document.getElementById('senderName');
const senderEmail = document.getElementById('senderEmail');
const recipientAddress = document.getElementById('recipientAddress');
const messageDate = document.getElementById('messageDate');

const emailFrame = document.getElementById('emailFrame');
const textPreviewBody = document.getElementById('textPreviewBody');
const sourcePreviewBody = document.getElementById('sourcePreviewBody');
const toastEl = document.getElementById('toast');

// Modal Elements
const authModal = document.getElementById('authModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalTabCreate = document.getElementById('modalTabCreate');
const modalTabLogin = document.getElementById('modalTabLogin');
const modalCreateForm = document.getElementById('modalCreateForm');
const modalLoginForm = document.getElementById('modalLoginForm');
const modalRegUsername = document.getElementById('modalRegUsername');
const modalRegDomainSelect = document.getElementById('modalRegDomainSelect');
const modalRegPassword = document.getElementById('modalRegPassword');
const modalToggleRegPass = document.getElementById('modalToggleRegPass');
const modalLoginEmail = document.getElementById('modalLoginEmail');
const modalLoginPass = document.getElementById('modalLoginPass');
const modalToggleLoginPass = document.getElementById('modalToggleLoginPass');

// Initialization
window.addEventListener('DOMContentLoaded', async () => {
  setupEventHandlers();
  await loadDomains();

  const saved = localStorage.getItem('mailtm_current_account');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.address && parsed.password && parsed.token) {
        currentAccount = parsed;
        renderActiveSession();
        startSyncLoop();
        showToast('Welcome back, ' + getShortName(currentAccount.address));
        return;
      }
    } catch(e) {
      console.warn('Session parse error:', e);
    }
  }

  // Not logged in: Show Mandatory Auth View
  renderLoggedOutView();
});

function setupEventHandlers() {
  // Profile Dropdown Toggle
  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isExpanded = profileBtn.getAttribute('aria-expanded') === 'true';
    toggleProfileDropdown(!isExpanded);
  });

  document.addEventListener('click', (e) => {
    if (!profileContainer.contains(e.target)) {
      toggleProfileDropdown(false);
    }
  });


  // Dropdown Copy Email
  dropdownCopyEmailBtn.addEventListener('click', () => {
    if (!currentAccount) return;
    navigator.clipboard.writeText(currentAccount.address);
    dropdownCopyEmailText.innerText = 'Copied!';
    showToast('Email address copied!');
    setTimeout(() => dropdownCopyEmailText.innerText = 'Copy Email Address', 2000);
  });

  // Dropdown Password Show/Hide
  let isPassRevealed = false;
  dropdownTogglePassBtn.addEventListener('click', () => {
    if (!currentAccount) return;
    isPassRevealed = !isPassRevealed;
    if (isPassRevealed) {
      dropdownPasswordText.textContent = currentAccount.password;
      dropdownPasswordText.classList.remove('pwd-masked');
      dropdownTogglePassBtn.textContent = 'Hide';
    } else {
      dropdownPasswordText.textContent = '••••••••••••';
      dropdownPasswordText.classList.add('pwd-masked');
      dropdownTogglePassBtn.textContent = 'Show';
    }
  });

  // Dropdown Copy Password
  dropdownCopyPassBtn.addEventListener('click', () => {
    if (!currentAccount) return;
    navigator.clipboard.writeText(currentAccount.password);
    showToast('Password copied to clipboard!');
  });

  // Dropdown Menu Actions
  dropdownCreateNewBtn.addEventListener('click', () => {
    toggleProfileDropdown(false);
    openModal('create');
  });

  dropdownLoginOtherBtn.addEventListener('click', () => {
    toggleProfileDropdown(false);
    openModal('login');
  });

  dropdownSignOutBtn.addEventListener('click', () => {
    toggleProfileDropdown(false);
    signOut();
  });

  // Nav Auth Buttons
  if (navSignInBtn) navSignInBtn.addEventListener('click', () => {
    switchLandingTab('login');
    loginAddress.focus();
  });

  if (navSignUpBtn) navSignUpBtn.addEventListener('click', () => {
    switchLandingTab('create');
    regUsername.focus();
  });

  // Landing Tabs Switcher
  if (tabSwitchCreate) tabSwitchCreate.addEventListener('click', () => switchLandingTab('create'));
  if (tabSwitchLogin) tabSwitchLogin.addEventListener('click', () => switchLandingTab('login'));

  // Pro Card Switch Button ("Create one" / "Sign in")
  const btnSwitchAuthMode = document.getElementById('btnSwitchAuthMode');
  if (btnSwitchAuthMode) {
    btnSwitchAuthMode.addEventListener('click', (e) => {
      e.preventDefault();
      const isLoginActive = landingLoginForm && landingLoginForm.classList.contains('active');
      switchLandingTab(isLoginActive ? 'create' : 'login');
    });
  }

  // Forgot password handler
  const btnForgotPass = document.getElementById('btnForgotPass');
  if (btnForgotPass) {
    btnForgotPass.addEventListener('click', (e) => {
      e.preventDefault();
      showToast('Enter your registered address & password to access.');
    });
  }

  // Password Visibility Toggles on Landing
  toggleRegPassBtn.addEventListener('click', () => {
    const isP = regPassword.type === 'password';
    regPassword.type = isP ? 'text' : 'password';
    toggleRegPassBtn.innerHTML = isP 
      ? '<svg class="eye-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>' 
      : '<svg class="eye-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  });

  toggleLoginPassBtn.addEventListener('click', () => {
    const isP = loginPass.type === 'password';
    loginPass.type = isP ? 'text' : 'password';
    toggleLoginPassBtn.innerHTML = isP 
      ? '<svg class="eye-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>' 
      : '<svg class="eye-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  });

  // Landing Create Form Submission
  landingCreateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = regUsername.value.trim();
    const domain = regDomainSelect.value;
    const pass = regPassword.value.trim();

    if (!user) return regUsername.focus();
    if (!domain) return alert('Active domain not detected yet.');
    if (!pass || pass.length < 6) {
      alert('Password must be at least 6 characters.');
      return regPassword.focus();
    }

    btnSubmitCreate.disabled = true;
    btnSubmitCreate.innerHTML = '<span>Creating...</span>';

    try {
      await createAccount(user, domain, pass);
    } finally {
      btnSubmitCreate.disabled = false;
      btnSubmitCreate.innerHTML = '<span>Create Account</span>';
    }
  });

  // Landing Login Form Submission
  landingLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const addr = loginAddress.value.trim();
    const pass = loginPass.value.trim();

    if (!addr) return loginAddress.focus();
    if (!pass) {
      alert('Password is required! Password ছাড়া লগইন করা যাবে না।');
      return loginPass.focus();
    }

    btnSubmitLogin.disabled = true;
    btnSubmitLogin.innerHTML = '<span>Signing In...</span>';

    try {
      await loginAccount(addr, pass);
    } finally {
      btnSubmitLogin.disabled = false;
      btnSubmitLogin.innerHTML = '<span>Sign In</span>';
    }
  });

  // Clear Recent Landing Chips
  if (btnLandingClearRecent) btnLandingClearRecent.addEventListener('click', () => {
    localStorage.removeItem('mailtm_recent_accounts');
    renderRecentAccounts();
    showToast('Cleared saved accounts');
  });

  // Manual Refresh
  manualRefreshBtn.addEventListener('click', triggerManualRefresh);

  // Search Filter
  filterMessagesInput.addEventListener('input', () => {
    renderMessagesList(filterMessagesInput.value);
  });


  // Delete Message
  btnDeleteMessage.addEventListener('click', async () => {
    if (!activeMessageId) return;
    if (confirm('Permanently delete this message?')) {
      await deleteMessage(activeMessageId);
    }
  });

  // Reader Tabs
  document.querySelectorAll('.reader-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.reader-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.body-pane').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const target = tab.dataset.tab;
      if (target === 'preview') document.getElementById('panePreview').classList.add('active');
      if (target === 'text') document.getElementById('paneText').classList.add('active');
      if (target === 'source') document.getElementById('paneSource').classList.add('active');
    });
  });

  // Modal Setup
  modalCloseBtn.addEventListener('click', () => authModal.classList.add('hidden'));
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) authModal.classList.add('hidden');
  });

  modalTabCreate.addEventListener('click', () => switchModalTab('create'));
  modalTabLogin.addEventListener('click', () => switchModalTab('login'));

  modalToggleRegPass.addEventListener('click', () => {
    const isP = modalRegPassword.type === 'password';
    modalRegPassword.type = isP ? 'text' : 'password';
    modalToggleRegPass.innerHTML = isP 
      ? '<svg class="eye-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>' 
      : '<svg class="eye-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  });

  modalToggleLoginPass.addEventListener('click', () => {
    const isP = modalLoginPass.type === 'password';
    modalLoginPass.type = isP ? 'text' : 'password';
    modalToggleLoginPass.innerHTML = isP 
      ? '<svg class="eye-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>' 
      : '<svg class="eye-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  });

  modalCreateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = modalRegUsername.value.trim();
    const dom = modalRegDomainSelect.value;
    const pass = modalRegPassword.value.trim();
    if (!user || !pass || pass.length < 6) return alert('Username & password (min 6 chars) required.');
    
    const btn = document.getElementById('modalSubmitCreateBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>Creating...</span>';
    }
    try {
      await createAccount(user, dom, pass);
      authModal.classList.add('hidden');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>Create Mailbox</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
      }
    }
  });

  modalLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const addr = modalLoginEmail.value.trim();
    const pass = modalLoginPass.value.trim();
    if (!addr || !pass) return alert('Both email and password are required.');

    const btn = document.getElementById('modalSubmitLoginBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>Signing in...</span>';
    }
    try {
      await loginAccount(addr, pass);
      authModal.classList.add('hidden');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>Switch Account</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
      }
    }
  });
}

function toggleProfileDropdown(open) {
  if (open) {
    profileBtn.setAttribute('aria-expanded', 'true');
    profileDropdown.classList.remove('hidden');
  } else {
    profileBtn.setAttribute('aria-expanded', 'false');
    profileDropdown.classList.add('hidden');
  }
}

async function loadDomains(forceFresh = false) {
  try {
    const res = await fetch('/api/domains' + (forceFresh ? '?fresh=true' : ''));
    const data = await res.json();
    if (data.success && data.domains.length > 0) {
      currentActiveDomain = data.activeDomain || data.domains[0].domain;
      const navBadge = document.getElementById('navActiveDomainBadge');
      if (navBadge) navBadge.textContent = '@' + currentActiveDomain;

      [regDomainSelect, modalRegDomainSelect].forEach(select => {
        if (!select) return;
        select.innerHTML = '';
        data.domains.forEach(d => {
          if (d.isActive) {
            const opt = document.createElement('option');
            opt.value = d.domain;
            opt.textContent = '@' + d.domain;
            select.appendChild(opt);
          }
        });
      });
    }
  } catch(err) {
    console.error('Domain fetch error:', err);
  }
}

async function createAccount(username, domain, password) {
  try {
    const res = await fetch('/api/create-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, domain, password })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to create account');

    currentAccount = data.account;
    saveRecentAccount(currentAccount);
    renderActiveSession();
    startSyncLoop();
    showToast('Mailbox ready: ' + currentAccount.address);
  } catch(err) {
    alert('Account creation failed: ' + err.message);
  }
}

async function loginAccount(address, password) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, password })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Login failed');

    currentAccount = data.account;
    saveRecentAccount(currentAccount);
    renderActiveSession();
    startSyncLoop();
    showToast('Signed in successfully!');
  } catch(err) {
    alert('Login failed: ' + err.message);
  }
}

function renderActiveSession() {
  localStorage.setItem('mailtm_current_account', JSON.stringify(currentAccount));

  const shortHandle = getShortName(currentAccount.address);
  const initial = shortHandle.charAt(0).toUpperCase();

  // Navbar Profile Button
  if (navAvatar) navAvatar.textContent = initial;
  if (navUsername) navUsername.textContent = shortHandle;
  if (profileContainer) profileContainer.classList.remove('hidden');
  if (loggedOutButtons) loggedOutButtons.classList.add('hidden');

  // Dropdown Details
  if (dropdownAvatar) dropdownAvatar.textContent = initial;
  if (dropdownEmail) dropdownEmail.textContent = currentAccount.address;
  if (dropdownPasswordText) {
    dropdownPasswordText.textContent = '••••••••••••';
    dropdownPasswordText.classList.add('pwd-masked');
  }
  if (dropdownTogglePassBtn) dropdownTogglePassBtn.textContent = 'Show';

  // Workspace View
  if (mandatoryAuthView) mandatoryAuthView.classList.add('hidden');
  if (inboxWorkspace) inboxWorkspace.classList.remove('hidden');

  renderRecentAccounts();

  messages = [];
  activeMessageId = null;
  if (readerPane) readerPane.classList.add('hidden');
  if (readerPlaceholder) readerPlaceholder.classList.remove('hidden');

  fetchMessages();
}

function renderLoggedOutView() {
  stopSyncLoop();
  currentAccount = null;
  localStorage.removeItem('mailtm_current_account');

  if (profileContainer) profileContainer.classList.add('hidden');
  if (loggedOutButtons) loggedOutButtons.classList.remove('hidden');

  if (mandatoryAuthView) mandatoryAuthView.classList.remove('hidden');
  if (inboxWorkspace) inboxWorkspace.classList.add('hidden');

  renderRecentAccounts();
}

function signOut() {
  renderLoggedOutView();
  showToast('Signed out of Mailflux');
}

function switchLandingTab(tab) {
  const cardTitle = document.getElementById('authCardTitle');
  const cardSubhead = document.getElementById('authCardSubtitle');
  const switchPrompt = document.getElementById('authSwitchPrompt');
  const switchBtn = document.getElementById('btnSwitchAuthMode');

  if (tab === 'create') {
    if (tabSwitchCreate) tabSwitchCreate.classList.add('active');
    if (tabSwitchLogin) tabSwitchLogin.classList.remove('active');
    if (landingCreateForm) landingCreateForm.classList.add('active');
    if (landingLoginForm) landingLoginForm.classList.remove('active');

    if (cardTitle) cardTitle.textContent = 'Create Account';
    if (cardSubhead) cardSubhead.textContent = 'Set up your private mailbox';
    if (switchPrompt) switchPrompt.textContent = 'Already have an account?';
    if (switchBtn) switchBtn.textContent = 'Sign in';

    if (regUsername) setTimeout(() => regUsername.focus(), 50);
  } else {
    if (tabSwitchLogin) tabSwitchLogin.classList.add('active');
    if (tabSwitchCreate) tabSwitchCreate.classList.remove('active');
    if (landingLoginForm) landingLoginForm.classList.add('active');
    if (landingCreateForm) landingCreateForm.classList.remove('active');

    if (cardTitle) cardTitle.textContent = 'Welcome Back';
    if (cardSubhead) cardSubhead.textContent = 'Sign in to your account';
    if (switchPrompt) switchPrompt.textContent = "Don't have an account?";
    if (switchBtn) switchBtn.textContent = 'Create one';

    if (loginAddress) setTimeout(() => loginAddress.focus(), 50);
  }
}

function switchModalTab(tab) {
  const modalTitleEl = document.getElementById('modalTitle');
  const modalSubheadEl = document.getElementById('modalSubtitle');
  if (tab === 'create') {
    modalTabCreate.classList.add('active');
    modalTabLogin.classList.remove('active');
    modalCreateForm.classList.add('active');
    modalLoginForm.classList.remove('active');
    if (modalTitleEl) modalTitleEl.textContent = 'New Mailbox';
    if (modalSubheadEl) modalSubheadEl.textContent = 'Set up an instant private address';
    setTimeout(() => modalRegUsername && modalRegUsername.focus(), 50);
  } else {
    modalTabLogin.classList.add('active');
    modalTabCreate.classList.remove('active');
    modalLoginForm.classList.add('active');
    modalCreateForm.classList.remove('active');
    if (modalTitleEl) modalTitleEl.textContent = 'Switch Account';
    if (modalSubheadEl) modalSubheadEl.textContent = 'Sign in to access your mailbox';
    setTimeout(() => modalLoginEmail && modalLoginEmail.focus(), 50);
  }
}

function openModal(tab = 'create') {
  switchModalTab(tab);
  authModal.classList.remove('hidden');
}

function saveRecentAccount(account) {
  try {
    let list = JSON.parse(localStorage.getItem('mailtm_recent_accounts') || '[]');
    list = list.filter(a => a.address.toLowerCase() !== account.address.toLowerCase());
    list.unshift({
      address: account.address,
      password: account.password,
      savedAt: new Date().toISOString()
    });
    list = list.slice(0, 8);
    localStorage.setItem('mailtm_recent_accounts', JSON.stringify(list));
    renderRecentAccounts();
  } catch(e) {
    console.error(e);
  }
}

function renderRecentAccounts() {
  try {
    const list = JSON.parse(localStorage.getItem('mailtm_recent_accounts') || '[]');
    savedCountBadge.textContent = list.length;

    // Dropdown list
    dropdownRecentList.innerHTML = '';
    if (list.length === 0) {
      dropdownRecentList.innerHTML = '<div style="color: var(--text-subtle); font-size: 11px; padding: 2px 0;">No other mailboxes saved.</div>';
    } else {
      list.forEach(acc => {
        const isCurr = currentAccount && currentAccount.address.toLowerCase() === acc.address.toLowerCase();
        const item = document.createElement('div');
        item.className = 'saved-mailbox-chip' + (isCurr ? ' active' : '');
        item.innerHTML = `
          <span style="overflow:hidden; text-overflow:ellipsis; max-width:200px;">${acc.address}</span>
          ${isCurr ? '<span style="color:#34D399; font-size:10px; font-weight:700;">Active</span>' : '<span style="color:var(--text-subtle); font-size:10px;">Switch</span>'}
        `;
        if (!isCurr) {
          item.addEventListener('click', async () => {
            toggleProfileDropdown(false);
            if (acc.password) {
              await loginAccount(acc.address, acc.password);
            } else {
              openModal('login');
              modalLoginEmail.value = acc.address;
            }
          });
        }
        dropdownRecentList.appendChild(item);
      });
    }

    // Landing chips (if present)
    if (landingRecentSection) {
      if (list.length > 0) {
        landingRecentSection.classList.remove('hidden');
      } else {
        landingRecentSection.classList.add('hidden');
      }
    }
  } catch(e) {
    console.error(e);
  }
}

async function fetchMessages() {
  if (!currentAccount || !currentAccount.token) return;

  try {
    const res = await fetch('/api/messages', {
      headers: {
        'Authorization': 'Bearer ' + currentAccount.token
      }
    });

    if (res.status === 401) {
      if (currentAccount.password) {
        await loginAccount(currentAccount.address, currentAccount.password);
      } else {
        signOut();
        alert('Session expired. Please sign in again.');
      }
      return;
    }

    const data = await res.json();
    if (data.success) {
      const incoming = data.messages || [];
      const seenIds = new Set(messages.filter(m => m.seen).map(m => m.id));
      if (activeMessageId) seenIds.add(activeMessageId);

      messages = incoming.map(m => {
        if (seenIds.has(m.id)) {
          return { ...m, seen: true };
        }
        return m;
      });

      renderMessagesList(filterMessagesInput.value);
    }
  } catch(err) {
    console.error('Fetch error:', err);
  }
}

function renderMessagesList(filterText = '') {
  if (!currentAccount) return;

  const filtered = messages.filter(m => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    const sender = (m.from?.name || m.from?.address || '').toLowerCase();
    const sub = (m.subject || '').toLowerCase();
    return sender.includes(q) || sub.includes(q);
  });

  const unreadCount = messages.filter(m => !m.seen).length;
  unreadBadge.textContent = unreadCount;
  unreadBadge.style.opacity = unreadCount > 0 ? '1' : '0.5';

  if (filtered.length === 0) {
    messagesContainer.innerHTML = `
      <div class="empty-state-list">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline>
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
        </svg>
        <h4>${messages.length === 0 ? 'No messages yet' : 'No matching emails'}</h4>
        <p>${messages.length === 0 ? 'Emails sent to your address will appear here instantly.' : 'Try adjusting your filter search.'}</p>
      </div>
    `;
    return;
  }

  messagesContainer.innerHTML = '';
  filtered.forEach(msg => {
    const card = document.createElement('div');
    card.className = 'msg-item-card' + (msg.id === activeMessageId ? ' active' : '') + (!msg.seen ? ' unread' : '');

    const senderNameStr = msg.from?.name || msg.from?.address || 'Unknown';
    const initial = senderNameStr.charAt(0).toUpperCase() || '?';
    const timeStr = formatHumanTime(msg.createdAt);

    card.innerHTML = `
      <div class="msg-avatar-icon">${escapeHtml(initial)}</div>
      <div class="msg-item-details">
        <div class="msg-row-top">
          <span class="msg-from-name" title="${escapeHtml(senderNameStr)}">${escapeHtml(senderNameStr)}</span>
          <div class="msg-time-wrap">
            <span class="msg-time-label">${timeStr}</span>
            ${!msg.seen ? '<span class="unread-glow-dot" title="Unread"></span>' : ''}
          </div>
        </div>
        <div class="msg-subject-line">${escapeHtml(msg.subject || '(No Subject)')}</div>
        <div class="msg-snippet-text">${escapeHtml(msg.intro || '')}</div>
      </div>
    `;

    card.addEventListener('click', () => loadMessage(msg.id));
    messagesContainer.appendChild(card);
  });
}

async function loadMessage(id) {
  if (!currentAccount) return;
  activeMessageId = id;

  // 1. Instantly mark as read locally so the dot disappears immediately
  const targetMsg = messages.find(m => m.id === id);
  if (targetMsg && !targetMsg.seen) {
    targetMsg.seen = true;
  }
  renderMessagesList(filterMessagesInput.value);

  // 2. Asynchronously notify backend to mark as seen on server
  fetch(`/api/messages/${id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + currentAccount.token,
      'Content-Type': 'application/json'
    }
  }).catch(() => {});

  readerPlaceholder.classList.add('hidden');
  readerPane.classList.remove('hidden');

  readerSubject.textContent = 'Loading message...';
  senderName.textContent = '...';
  senderEmail.textContent = '';
  recipientAddress.textContent = currentAccount.address;
  messageDate.textContent = '...';

  try {
    const res = await fetch(`/api/messages/${id}`, {
      headers: { 'Authorization': 'Bearer ' + currentAccount.token }
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const msg = data.message;
    readerSubject.textContent = msg.subject || '(No Subject)';
    senderName.textContent = msg.from?.name || msg.from?.address || 'Unknown';
    senderEmail.textContent = msg.from?.address ? `<${msg.from.address}>` : '';
    senderAvatar.textContent = (senderName.textContent.charAt(0) || 'S').toUpperCase();
    recipientAddress.textContent = msg.to?.map(t => t.address).join(', ') || currentAccount.address;
    messageDate.textContent = new Date(msg.createdAt).toLocaleString();

    let html = msg.html && msg.html.length > 0 ? msg.html.join('') : '';
    if (!html && msg.text) {
      html = `<pre style="font-family: sans-serif; white-space: pre-wrap; padding: 20px; color: #222;">${escapeHtml(msg.text)}</pre>`;
    }

    const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
    emailFrame.src = URL.createObjectURL(blob);

    textPreviewBody.textContent = msg.text || '(No plain text body)';
    sourcePreviewBody.textContent = JSON.stringify(msg, null, 2);

  } catch(err) {
    readerSubject.textContent = 'Error loading message';
    textPreviewBody.textContent = err.message;
  }
}

async function deleteMessage(id) {
  if (!currentAccount) return;
  try {
    const res = await fetch(`/api/messages/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + currentAccount.token }
    });
    const data = await res.json();
    if (data.success) {
      showToast('Message deleted');
      messages = messages.filter(m => m.id !== id);
      activeMessageId = null;
      renderMessagesList(filterMessagesInput.value);
      readerPane.classList.add('hidden');
      readerPlaceholder.classList.remove('hidden');
    }
  } catch(err) {
    alert('Failed to delete: ' + err.message);
  }
}

function triggerManualRefresh() {
  manualRefreshIcon.style.animation = 'spin 1s linear infinite';
  fetchMessages().then(() => {
    setTimeout(() => {
      manualRefreshIcon.style.animation = '';
    }, 600);
  });
}

function startSyncLoop() {
  stopSyncLoop();
  if (!currentAccount) return;

  countdownInterval = setInterval(() => {
    if (!currentAccount) return;
    fetchMessages();
  }, 5000);
}

function stopSyncLoop() {
  if (countdownInterval) clearInterval(countdownInterval);
}

function getShortName(addr) {
  if (!addr) return 'User';
  return addr.split('@')[0];
}

function formatHumanTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffSec = Math.floor((now - d) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return Math.floor(diffSec / 60) + 'm ago';
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(msg) {
  toastEl.innerText = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2600);
}


// ==========================================================================
// APPLE LIQUID GLASS TACTILE BUTTON RIPPLE
// ==========================================================================
document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('button, .btn-link-action, .reader-tab, .msg-item-card, .btn-dropdown-copy, .dropdown-menu-item');
  if (!btn) return;

  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.6;
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const ripple = document.createElement('span');
  ripple.className = 'liquid-btn-ripple';
  ripple.style.width = size + 'px';
  ripple.style.height = size + 'px';
  ripple.style.left = x + 'px';
  ripple.style.top = y + 'px';

  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 700);
});

