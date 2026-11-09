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

// Landing Auth Elements (100% User Design Spec)
const fSignin = document.getElementById('f-signin');
const fCreate = document.getElementById('f-create');
const siEmail = document.getElementById('si-email');
const siPass = document.getElementById('si-pass');
const crUser = document.getElementById('cr-user');
const crPass = document.getElementById('cr-pass');
const tSignin = document.getElementById('t-signin');
const tCreate = document.getElementById('t-create');

// Workspace Message List Elements
const unreadBadge = document.getElementById('unreadBadge');
const manualRefreshBtn = document.getElementById('manualRefreshBtn');
const manualRefreshIcon = document.getElementById('manualRefreshIcon');
const filterMessagesInput = document.getElementById('filterMessagesInput');
const messagesContainer = document.getElementById('messagesContainer');

// Nav Search Bar Elements
const navSearchContainer = document.getElementById('navSearchContainer');
const topSearchInput = document.getElementById('topSearchInput');
const topSearchClearBtn = document.getElementById('topSearchClearBtn');

function getSearchQuery() {
  if (topSearchInput && topSearchInput.value) return topSearchInput.value.trim();
  if (filterMessagesInput && filterMessagesInput.value) return filterMessagesInput.value.trim();
  return '';
}

// Folder State & Elements
let currentFolder = 'inbox'; // 'inbox' | 'sent'
let sentMessages = [];
const tabInbox = document.getElementById('tabInbox');
const tabSent = document.getElementById('tabSent');
const sentBadge = document.getElementById('sentBadge');

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

// Compose Modal Elements
const composeModal = document.getElementById('composeModal');
const btnOpenCompose = document.getElementById('btnOpenCompose');
const composeMaximizeBtn = document.getElementById('composeMaximizeBtn');
const composeCloseBtn = document.getElementById('composeCloseBtn');
const composeCancelBtn = document.getElementById('composeCancelBtn');
const composeForm = document.getElementById('composeForm');
const composeFromAddress = document.getElementById('composeFromAddress');
const composeToInput = document.getElementById('composeToInput');
const composeSubjectInput = document.getElementById('composeSubjectInput');
const composeBodyInput = document.getElementById('composeBodyInput');
const composeSubmitBtn = document.getElementById('composeSubmitBtn');

// Google Drive & 60 MB Storage Elements
const gdriveModal = document.getElementById('gdriveModal');
const gdriveCloseBtn = document.getElementById('gdriveCloseBtn');
const gdriveMailboxAddress = document.getElementById('gdriveMailboxAddress');
const btnConnectGoogleDrive = document.getElementById('btnConnectGoogleDrive');
const btnConnectGoogleDriveText = document.getElementById('btnConnectGoogleDriveText');
const gdrivePermissionAlert = document.getElementById('gdrivePermissionAlert');

const sidebarStorageWidget = document.getElementById('sidebarStorageWidget');
const storageUsedText = document.getElementById('storageUsedText');
const storageProgressBar = document.getElementById('storageProgressBar');
const gdriveStatusPill = document.getElementById('gdriveStatusPill');
const gdriveStatusText = document.getElementById('gdriveStatusText');
const storageLinkedAccount = document.getElementById('storageLinkedAccount');
const storageLinkedEmail = document.getElementById('storageLinkedEmail');
const dropdownGdriveChip = document.getElementById('dropdownGdriveChip');
const dropdownGdriveEmail = document.getElementById('dropdownGdriveEmail');
const btnSyncDrive = document.getElementById('btnSyncDrive');
const btnOpenDriveFile = document.getElementById('btnOpenDriveFile');
const dropdownDriveViewLink = document.getElementById('dropdownDriveViewLink');

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  purgeExpiredLocalMails();
  setupEventHandlers();

  // Instant session restore: 0ms delay, zero flash of login screen
  const saved = localStorage.getItem('mailtm_current_account');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.address && parsed.password && parsed.token) {
        currentAccount = parsed;
        document.documentElement.classList.add('has-session');
        renderActiveSession();
        startSyncLoop();
        // Load domains in background without blocking UI
        loadDomains();
        return;
      }
    } catch(e) {
      console.warn('Session parse error:', e);
    }
  }

  // Not logged in: Show Mandatory Auth View
  document.documentElement.classList.remove('has-session');
  renderLoggedOutView();
  loadDomains();
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
    if (window.showLandingTab) window.showLandingTab('signin');
    if (siEmail) siEmail.focus();
  });

  if (navSignUpBtn) navSignUpBtn.addEventListener('click', () => {
    if (window.showLandingTab) window.showLandingTab('create');
    if (crUser) crUser.focus();
  });

  // Setup 100% User Landing Auth Flow
  setupLandingUserAuth();

  // Clear Recent Landing Chips
  const btnLandingClearRecent = document.getElementById('btnLandingClearRecent');
  if (btnLandingClearRecent) {
    btnLandingClearRecent.addEventListener('click', () => {
      localStorage.removeItem('mailtm_recent_accounts');
      renderRecentAccounts();
      showToast('Cleared saved accounts');
    });
  }

  // Manual Refresh
  if (manualRefreshBtn) manualRefreshBtn.addEventListener('click', triggerManualRefresh);

  // Folder Tabs (Inbox & Sent)
  if (tabInbox) {
    tabInbox.addEventListener('click', () => {
      if (currentFolder === 'inbox') return;
      currentFolder = 'inbox';
      tabInbox.classList.add('active');
      if (tabSent) tabSent.classList.remove('active');
      activeMessageId = null;
      if (readerPane) readerPane.classList.add('hidden');
      if (readerPlaceholder) readerPlaceholder.classList.remove('hidden');
      renderMessagesList(getSearchQuery());
    });
  }

  if (tabSent) {
    tabSent.addEventListener('click', async () => {
      if (currentFolder === 'sent') return;
      currentFolder = 'sent';
      tabSent.classList.add('active');
      if (tabInbox) tabInbox.classList.remove('active');
      activeMessageId = null;
      if (readerPane) readerPane.classList.add('hidden');
      if (readerPlaceholder) readerPlaceholder.classList.remove('hidden');
      renderMessagesList(getSearchQuery());
      await fetchSentMessages();
    });
  }

  // Top Navbar Search Filter
  if (topSearchInput) {
    topSearchInput.addEventListener('input', () => {
      const q = topSearchInput.value;
      if (topSearchClearBtn) {
        if (q.length > 0) topSearchClearBtn.classList.remove('hidden');
        else topSearchClearBtn.classList.add('hidden');
      }
      if (filterMessagesInput) filterMessagesInput.value = q;
      renderMessagesList(q);
    });

    if (topSearchClearBtn) {
      topSearchClearBtn.addEventListener('click', () => {
        topSearchInput.value = '';
        topSearchClearBtn.classList.add('hidden');
        if (filterMessagesInput) filterMessagesInput.value = '';
        renderMessagesList('');
        topSearchInput.focus();
      });
    }

    // Keyboard shortcut: Press '/' or 'Ctrl+K' to focus search
    document.addEventListener('keydown', (e) => {
      if ((e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'k')) && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        if (inboxWorkspace && !inboxWorkspace.classList.contains('hidden')) {
          e.preventDefault();
          topSearchInput.focus();
          topSearchInput.select();
        }
      }
      if (e.key === 'Escape' && document.activeElement === topSearchInput) {
        topSearchInput.blur();
      }
    });
  }

  // Sidebar Search Filter (sync fallback)
  if (filterMessagesInput) {
    filterMessagesInput.addEventListener('input', () => {
      const q = filterMessagesInput.value;
      if (topSearchInput) topSearchInput.value = q;
      renderMessagesList(q);
    });
  }

  // Delete Message
  if (btnDeleteMessage) {
    btnDeleteMessage.addEventListener('click', async () => {
      if (!activeMessageId) return;
      if (confirm('Permanently delete this message?')) {
        await deleteMessage(activeMessageId);
      }
    });
  }

  // Reader Tabs
  document.querySelectorAll('.reader-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.reader-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.body-pane').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const target = tab.dataset.tab;
      if (target === 'preview') document.getElementById('panePreview')?.classList.add('active');
      if (target === 'text') document.getElementById('paneText')?.classList.add('active');
      if (target === 'source') document.getElementById('paneSource')?.classList.add('active');
    });
  });

  // Modal Setup
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (authModal) authModal.classList.add('hidden');
    });
  }
  if (authModal) {
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) {
        authModal.classList.add('hidden');
      }
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && authModal && !authModal.classList.contains('hidden')) {
      authModal.classList.add('hidden');
    }
  });

  if (modalTabCreate) modalTabCreate.addEventListener('click', () => switchModalTab('create'));
  if (modalTabLogin) modalTabLogin.addEventListener('click', () => switchModalTab('login'));

  const modalForgotPass = document.getElementById('modalForgotPass');
  if (modalForgotPass) {
    modalForgotPass.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal();
      openRecoveryModal(modalLoginEmail ? modalLoginEmail.value : '');
    });
  }

  if (modalToggleRegPass) {
    modalToggleRegPass.addEventListener('click', () => {
      const isP = modalRegPassword.type === 'password';
      modalRegPassword.type = isP ? 'text' : 'password';
      modalToggleRegPass.innerHTML = isP 
        ? '<svg class="eye-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>' 
        : '<svg class="eye-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    });
  }

  if (modalToggleLoginPass) {
    modalToggleLoginPass.addEventListener('click', () => {
      const isP = modalLoginPass.type === 'password';
      modalLoginPass.type = isP ? 'text' : 'password';
      modalToggleLoginPass.innerHTML = isP 
        ? '<svg class="eye-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>' 
        : '<svg class="eye-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    });
  }

  if (modalCreateForm) {
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
      } catch(err) {
        showToast(err.message || 'Failed to create mailbox');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>Create Mailbox</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
        }
      }
    });
  }

  if (modalLoginForm) {
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
      } catch(err) {
        showToast(err.message || 'Login failed. Check your password.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>Switch Account</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
        }
      }
    });
  }

  // Compose Email Modal Handlers
  if (btnOpenCompose) {
    btnOpenCompose.addEventListener('click', () => {
      if (!currentAccount || !currentAccount.address) {
        showToast('Please sign in or create a mailbox first to send emails.');
        return;
      }
      if (composeFromAddress) {
        composeFromAddress.textContent = currentAccount.address;
      }
      if (composeToInput) composeToInput.value = '';
      if (composeSubjectInput) composeSubjectInput.value = '';
      if (composeBodyInput) composeBodyInput.value = '';
      if (composeModal) composeModal.classList.remove('hidden');
      setTimeout(() => composeToInput?.focus(), 100);
    });
  }

  function closeComposeModal() {
    if (composeModal) {
      composeModal.classList.add('hidden');
      composeModal.classList.remove('is-fullscreen');
    }
  }

  if (composeMaximizeBtn) {
    composeMaximizeBtn.addEventListener('click', () => {
      if (composeModal) {
        composeModal.classList.toggle('is-fullscreen');
      }
    });
  }

  if (composeCloseBtn) composeCloseBtn.addEventListener('click', closeComposeModal);
  if (composeCancelBtn) composeCancelBtn.addEventListener('click', closeComposeModal);

  if (composeModal) {
    composeModal.addEventListener('click', (e) => {
      if (e.target === composeModal) closeComposeModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && composeModal && !composeModal.classList.contains('hidden')) {
      closeComposeModal();
    }
  });

  if (composeForm) {
    composeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentAccount || !currentAccount.token) {
        showToast('You must be signed in to send emails.');
        return;
      }

      const to = composeToInput.value.trim();
      const subject = composeSubjectInput.value.trim();
      const text = composeBodyInput.value.trim();

      if (!to || !to.includes('@')) {
        showToast('Please enter a valid recipient email address.');
        return;
      }

      if (composeSubmitBtn) {
        composeSubmitBtn.disabled = true;
        composeSubmitBtn.innerHTML = '<span>Sending...</span>';
      }

      try {
        const res = await fetch('/api/send-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentAccount.token}`
          },
          body: JSON.stringify({ to, subject, text })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to send message');
        }

        showToast('Message sent successfully!');
        closeComposeModal();
        composeForm.reset();
        await fetchSentMessages();
        if (currentFolder === 'sent') {
          renderMessagesList(getSearchQuery());
        }
        syncMailboxToGoogleDrive(true);
      } catch (err) {
        console.error('Send mail error:', err);
        showToast(err.message || 'Error delivering email');
      } finally {
        if (composeSubmitBtn) {
          composeSubmitBtn.disabled = false;
          composeSubmitBtn.innerHTML = `<span>Send Message</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>`;
        }
      }
    });
  }

  // Google Drive Connection & Sync Handlers
  if (btnConnectGoogleDrive) {
    btnConnectGoogleDrive.addEventListener('click', connectGoogleDriveAccount);
  }

  if (gdriveCloseBtn) {
    gdriveCloseBtn.addEventListener('click', () => {
      if (gdriveModal) {
        gdriveModal.classList.add('hidden');
        gdriveModal.style.display = 'none';
      }
    });
  }

  if (btnSyncDrive) {
    btnSyncDrive.addEventListener('click', async (e) => {
      e.stopPropagation();
      await triggerDriveSync();
    });
  }

  if (sidebarStorageWidget) {
    sidebarStorageWidget.style.cursor = 'pointer';
    sidebarStorageWidget.addEventListener('click', async (e) => {
      if (e.target && (e.target.id === 'btnOpenDriveFile' || e.target.closest('#btnOpenDriveFile'))) return;
      if (e.target && (e.target.id === 'btnSyncDrive' || e.target.closest('#btnSyncDrive'))) return;

      if (currentAccount && (currentAccount.gdriveLinked || gdriveLinkedState || currentAccount.driveFileId)) {
        await triggerDriveSync();
      } else {
        showMandatoryGDriveModal();
      }
    });
  }
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

      if (window.refreshLandingDomainOptions) {
        window.refreshLandingDomainOptions(data.domains, currentActiveDomain);
      }

      if (modalRegDomainSelect) {
        modalRegDomainSelect.innerHTML = '';
        data.domains.forEach(d => {
          if (d.isActive) {
            const opt = document.createElement('option');
            opt.value = d.domain;
            opt.textContent = d.domain;
            modalRegDomainSelect.appendChild(opt);
          }
        });
      }
    }
  } catch(err) {
    console.error('Domain fetch error:', err);
  }
}

async function createAccount(username, domain, password) {
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
  return currentAccount;
}

async function loginAccount(address, password) {
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
  return currentAccount;
}

function renderActiveSession() {
  localStorage.setItem('mailtm_current_account', JSON.stringify(currentAccount));
  document.documentElement.classList.add('has-session');

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
  if (navSearchContainer) navSearchContainer.classList.remove('hidden');

  renderRecentAccounts();

  // Restore 24-hour local cached messages instantly
  const cachedMsgs = loadCachedMessages(currentAccount.address);
  if (cachedMsgs && cachedMsgs.length > 0) {
    messages = cachedMsgs;
    renderMessagesList(getSearchQuery());
  } else {
    messages = [];
  }

  activeMessageId = null;
  if (readerPane) readerPane.classList.add('hidden');
  if (readerPlaceholder) readerPlaceholder.classList.remove('hidden');

  currentFolder = 'inbox';
  if (tabInbox) tabInbox.classList.add('active');
  if (tabSent) tabSent.classList.remove('active');

  fetchMessages();
  fetchSentMessages();
  checkGoogleDriveStatus();
}

function renderLoggedOutView() {
  document.documentElement.classList.remove('has-session');
  stopSyncLoop();
  currentAccount = null;
  sentMessages = [];
  localStorage.removeItem('mailtm_current_account');

  if (profileContainer) profileContainer.classList.add('hidden');
  if (loggedOutButtons) loggedOutButtons.classList.remove('hidden');
  if (navSearchContainer) navSearchContainer.classList.add('hidden');
  if (topSearchInput) topSearchInput.value = '';
  if (topSearchClearBtn) topSearchClearBtn.classList.add('hidden');
  if (filterMessagesInput) filterMessagesInput.value = '';
  if (sentBadge) sentBadge.classList.add('hidden');

  if (mandatoryAuthView) mandatoryAuthView.classList.remove('hidden');
  if (inboxWorkspace) inboxWorkspace.classList.add('hidden');

  renderRecentAccounts();
  if (window.showLandingTab) {
    const hash = (location.hash || '').replace('#', '');
    window.showLandingTab(hash === 'create' ? 'create' : 'signin');
  }
}

function signOut() {
  renderLoggedOutView();
  showToast('Signed out of Mailflux');
}

function setupLandingUserAuth() {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  const eyeOn = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const eyeOff = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.6 8.5 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

  const tabs = $('.tabs');
  const forms = { signin: $('#f-signin'), create: $('#f-create') };
  const titles = { signin: 'Sign in', create: 'Create account' };

  window.showLandingTab = function(v) {
    if (!tabs || !forms.signin || !forms.create) return;
    if (!forms[v]) v = 'signin';
    tabs.dataset.view = v;
    ['signin', 'create'].forEach(k => {
      if (forms[k]) forms[k].hidden = (k !== v);
      const btn = $('#t-' + k);
      if (btn) {
        btn.setAttribute('aria-selected', k === v);
        btn.tabIndex = k === v ? 0 : -1;
      }
    });
    document.title = 'MailFlux – ' + titles[v];
  };

  function route() {
    const hash = (location.hash || '').replace('#', '');
    if (hash === 'create' || hash === 'signin') {
      window.showLandingTab(hash);
    }
  }
  window.addEventListener('hashchange', route);
  route();

  $$('.tabs button').forEach(b => {
    b.addEventListener('click', () => {
      location.hash = b.id.replace('t-', '');
    });
  });

  if (tabs) {
    tabs.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const n = tabs.dataset.view === 'signin' ? 'create' : 'signin';
        location.hash = n;
        const targetBtn = $('#t-' + n);
        if (targetBtn) targetBtn.focus();
      }
    });
  }

  // Password visibility toggles
  $$('.eye').forEach(b => {
    b.innerHTML = eyeOn;
    b.addEventListener('click', () => {
      const i = b.parentNode.querySelector('input');
      if (!i) return;
      const isPass = i.type === 'password';
      i.type = isPass ? 'text' : 'password';
      b.innerHTML = isPass ? eyeOff : eyeOn;
      b.setAttribute('aria-pressed', isPass);
      b.setAttribute('aria-label', isPass ? 'Hide password' : 'Show password');
    });
  });

  // Validation helpers
  window.failField = function(input, text) {
    if (!input) return false;
    const f = input.closest('.field');
    if (!f) return false;
    f.classList.add('bad');
    const bx = f.querySelector('.box');
    if (bx) bx.classList.add('err');
    const msg = f.querySelector('.msg');
    if (msg) msg.textContent = text;
    return false;
  };

  window.clearField = function(input) {
    if (!input) return;
    const f = input.closest('.field');
    if (!f) return;
    f.classList.remove('bad');
    $$('.box', f).forEach(b => b.classList.remove('err'));
  };

  $$('input').forEach(i => {
    i.addEventListener('input', () => window.clearField(i));
  });

  // Custom domain dropdown
  const dom = $('#dom');
  if (dom) {
    const btn = $('button', dom);
    const menu = $('.menu', dom);

    function setOpen(o) {
      dom.classList.toggle('open', o);
      const parentField = dom.closest('.field');
      if (parentField) parentField.style.zIndex = o ? '1000' : '';
      if (btn) btn.setAttribute('aria-expanded', o);
      if (o) {
        const opts = $$('li', menu);
        const cur = opts.findIndex(x => x.getAttribute('aria-selected') === 'true');
        opts.forEach((x, i) => x.classList.toggle('act', i === cur));
      }
    }

    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(!dom.classList.contains('open'));
      });
    }

    function selectDomain(val) {
      if (!val) return;
      const domVal = $('#dom-val');
      if (domVal) domVal.textContent = val;
      currentActiveDomain = val;
      if (modalRegDomainSelect) modalRegDomainSelect.value = val;

      $$('li', menu).forEach(x => {
        const itemVal = x.dataset.v || x.textContent.trim();
        const isSel = (itemVal === val);
        x.setAttribute('aria-selected', isSel ? 'true' : 'false');
        x.classList.toggle('act', isSel);
      });

      setOpen(false);
      updatePreview();
      if (btn) btn.focus();
    }

    // Attach event listeners to initial menu items as well as delegated menu clicks
    if (menu) {
      menu.addEventListener('mousedown', (e) => {
        const li = e.target.closest('li[role="option"]');
        if (!li) return;
        e.preventDefault();
        e.stopPropagation();
        const val = li.dataset.v || li.textContent.trim();
        selectDomain(val);
      });

      menu.addEventListener('click', (e) => {
        const li = e.target.closest('li[role="option"]');
        if (!li) return;
        e.preventDefault();
        e.stopPropagation();
        const val = li.dataset.v || li.textContent.trim();
        selectDomain(val);
      });
    }

    document.addEventListener('click', (e) => {
      if (!dom.contains(e.target)) setOpen(false);
    });

    window.refreshLandingDomainOptions = function(domains, activeDomain) {
      if (!menu) return;
      menu.innerHTML = '';
      domains.forEach((d, idx) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.dataset.v = d.domain;
        const isSel = (d.domain === activeDomain) || (idx === 0 && !activeDomain);
        li.setAttribute('aria-selected', isSel ? 'true' : 'false');
        li.textContent = d.domain;
        if (isSel) {
          const domVal = $('#dom-val');
          if (domVal) domVal.textContent = d.domain;
        }
        menu.appendChild(li);
      });
    };
  }

  const user = $('#cr-user');
  function updatePreview() {
    if (!user) return;
    const u = user.value.trim().toLowerCase() || 'username';
    const domVal = $('#dom-val');
    const domText = domVal ? domVal.textContent : 'mailflux.online';
    const prev = $('#preview');
    if (prev) {
      prev.innerHTML = 'Your address: <em></em>';
      const em = prev.querySelector('em');
      if (em) em.textContent = u + '@' + domText;
    }
  }

  if (user) {
    user.addEventListener('input', () => {
      user.value = user.value.replace(/[^a-zA-Z0-9._-]/g, '');
      updatePreview();
    });
  }

  // Password strength meter
  const cp = $('#cr-pass');
  if (cp) {
    const bars = $$('.meter i');
    const cols = ['#ff6b81', '#ffb454', '#7c9bff', '#34d399'];
    const words = ['Too short', 'Weak', 'Okay', 'Strong'];
    cp.addEventListener('input', () => {
      const v = cp.value;
      let s = 0;
      if (v.length >= 6) s++;
      if (v.length >= 10) s++;
      if (/[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v)) s++;
      if (/[^A-Za-z0-9]/.test(v) && v.length >= 8) s++;
      s = v ? Math.max(s, 1) : 0;
      bars.forEach((b, i) => {
        b.style.background = i < s ? cols[s - 1] : '';
      });
      const strength = $('#strength');
      if (strength) {
        strength.textContent = v 
          ? (v.length < 6 ? words[0] : words[s - 1]) + (v.length < 6 ? ' – use at least 6 characters.' : ' password.')
          : 'Use 6+ characters. Add numbers and symbols for a stronger password.';
      }
    });
  }

  // Forgot password handler
  const siForgot = $('#si-forgot');
  if (siForgot) {
    siForgot.addEventListener('click', (e) => {
      e.preventDefault();
      const prefill = $('#si-email') ? $('#si-email').value : '';
      openRecoveryModal(prefill);
    });
  }

  // Swap links ("Create one" / "Sign in")
  $$('.swap a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = (a.getAttribute('href') || '').replace('#', '');
      location.hash = target;
      window.showLandingTab(target);
    });
  });

  // Submit Sign In Form
  if (forms.signin) {
    forms.signin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const em = $('#si-email');
      const pw = $('#si-pass');
      let ok = true;

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.value.trim())) {
        window.failField(em, 'Enter a valid email address, like you@mailflux.online.');
        ok = false;
      }
      if (!pw.value) {
        window.failField(pw, 'Enter your password.');
        ok = false;
      }
      if (!ok) {
        const firstBad = forms.signin.querySelector('.field.bad input');
        if (firstBad) firstBad.focus();
        return;
      }

      const cta = forms.signin.querySelector('.cta');
      const toast = forms.signin.querySelector('.toast');
      if (cta) { cta.classList.add('load'); cta.disabled = true; }
      if (toast) toast.classList.remove('on');

      try {
        await loginAccount(em.value.trim(), pw.value.trim());
      } catch(err) {
        window.failField(pw, err.message || 'Login failed. Check your password.');
        pw.focus();
      } finally {
        if (cta) { cta.classList.remove('load'); cta.disabled = false; }
      }
    });
  }

  // Submit Create Account Form
  if (forms.create) {
    forms.create.addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = $('#cr-user');
      const pw = $('#cr-pass');
      const domVal = $('#dom-val');
      const domain = domVal ? domVal.textContent : 'mailflux.online';
      let ok = true;

      if (u.value.trim().length < 3) {
        window.failField(u, 'Username needs at least 3 characters (letters, numbers, . _ -).');
        ok = false;
      }
      if (pw.value.length < 6) {
        window.failField(pw, 'Password needs at least 6 characters.');
        ok = false;
      }
      if (!ok) {
        const firstBad = forms.create.querySelector('.field.bad input');
        if (firstBad) firstBad.focus();
        return;
      }

      const cta = forms.create.querySelector('.cta');
      const toast = forms.create.querySelector('.toast');
      if (cta) { cta.classList.add('load'); cta.disabled = true; }
      if (toast) toast.classList.remove('on');

      try {
        await createAccount(u.value.trim().toLowerCase(), domain, pw.value.trim());
      } catch(err) {
        window.failField(u, err.message || 'Failed to create mailbox.');
        u.focus();
      } finally {
        if (cta) { cta.classList.remove('load'); cta.disabled = false; }
      }
    });
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
    if (modalTitleEl) modalTitleEl.textContent = 'Create Permanent Mailbox';
    if (modalSubheadEl) modalSubheadEl.textContent = 'Set up your personal address on our official domains';
    setTimeout(() => modalRegUsername && modalRegUsername.focus(), 50);
  } else {
    modalTabLogin.classList.add('active');
    modalTabCreate.classList.remove('active');
    modalLoginForm.classList.add('active');
    modalCreateForm.classList.remove('active');
    if (modalTitleEl) modalTitleEl.textContent = 'Switch Account';
    if (modalSubheadEl) modalSubheadEl.textContent = 'Sign in to access your permanent mailbox';
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

// ==========================================================================
// PERMANENT LOCAL PC DATABASE FOR EMAILS (60 MB QUOTA PER MAILBOX)
// ==========================================================================
const LOCAL_STORAGE_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000; // 1 year permanent local storage

function getCacheKeyMessages(address) {
  return `mailflux_cache_msgs_${(address || '').toLowerCase().trim()}`;
}

function getCacheKeyBody(address, messageId) {
  return `mailflux_cache_body_${(address || '').toLowerCase().trim()}_${messageId}`;
}

function purgeExpiredLocalMails() {
  try {
    const now = Date.now();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('mailflux_cache_msgs_') || key.startsWith('mailflux_cache_body_'))) {
        try {
          const item = JSON.parse(localStorage.getItem(key));
          if (!item || !item.expiresAt || now > item.expiresAt) {
            localStorage.removeItem(key);
          }
        } catch {
          localStorage.removeItem(key);
        }
      }
    }
  } catch (err) {
    console.warn('Cache purge error:', err);
  }
}

function loadCachedMessages(address) {
  if (!address) return [];
  try {
    purgeExpiredLocalMails();
    const raw = localStorage.getItem(getCacheKeyMessages(address));
    if (!raw) return [];
    const payload = JSON.parse(raw);
    if (!payload || !payload.expiresAt || Date.now() > payload.expiresAt) {
      localStorage.removeItem(getCacheKeyMessages(address));
      return [];
    }
    return Array.isArray(payload.messages) ? payload.messages : [];
  } catch (err) {
    console.warn('Error loading cached messages:', err);
    return [];
  }
}

function saveCachedMessages(address, msgList) {
  if (!address || !Array.isArray(msgList)) return;
  try {
    const payload = {
      timestamp: Date.now(),
      expiresAt: Date.now() + LOCAL_STORAGE_EXPIRY_MS,
      messages: msgList
    };
    localStorage.setItem(getCacheKeyMessages(address), JSON.stringify(payload));
  } catch (err) {
    console.warn('Error saving cached messages:', err);
  }
}

function loadCachedMessageBody(address, messageId) {
  if (!address || !messageId) return null;
  try {
    const raw = localStorage.getItem(getCacheKeyBody(address, messageId));
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload || !payload.expiresAt || Date.now() > payload.expiresAt) {
      localStorage.removeItem(getCacheKeyBody(address, messageId));
      return null;
    }
    return payload.data || null;
  } catch (err) {
    return null;
  }
}

function saveCachedMessageBody(address, messageId, data) {
  if (!address || !messageId || !data) return;
  try {
    const payload = {
      timestamp: Date.now(),
      expiresAt: Date.now() + LOCAL_STORAGE_EXPIRY_MS,
      data
    };
    localStorage.setItem(getCacheKeyBody(address, messageId), JSON.stringify(payload));
  } catch (err) {
    purgeExpiredLocalMails();
  }
}

function renderMessageDetails(msg) {
  if (!msg) return;
  readerSubject.textContent = msg.subject || '(No Subject)';
  senderName.textContent = msg.from?.name || msg.from?.address || 'Unknown';
  senderEmail.textContent = msg.from?.address ? `<${msg.from.address}>` : '';
  senderAvatar.textContent = (senderName.textContent.charAt(0) || 'S').toUpperCase();
  recipientAddress.textContent = msg.to?.map(t => t.address).join(', ') || (currentAccount ? currentAccount.address : '');
  messageDate.textContent = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : '';

  let html = msg.html && msg.html.length > 0 ? (Array.isArray(msg.html) ? msg.html.join('') : msg.html) : '';
  if (!html && msg.text) {
    html = `<pre style="font-family: sans-serif; white-space: pre-wrap; padding: 20px; color: #222; word-break: break-word;">${linkify(escapeHtml(msg.text))}</pre>`;
  }

  const processedHtml = prepareEmailHtml(html);
  const blob = new Blob([processedHtml], { type: 'text/html; charset=utf-8' });
  emailFrame.src = URL.createObjectURL(blob);

  textPreviewBody.innerHTML = linkify(escapeHtml(msg.text || '(No plain text body)'));
  sourcePreviewBody.textContent = JSON.stringify(msg, null, 2);
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

      const prevMessagesCount = messages ? messages.length : 0;
      messages = incoming.map(m => {
        if (seenIds.has(m.id)) {
          return { ...m, seen: true };
        }
        return m;
      });

      // Persist to 24-hour local storage
      saveCachedMessages(currentAccount.address, messages);
      syncMailboxToGoogleDrive(true);

      if (currentFolder === 'inbox') {
        renderMessagesList(getSearchQuery());
      }

      // Automatically auto-sync with Google Drive database whenever emails change
      if (incoming.length !== prevMessagesCount) {
        syncMailboxToGoogleDrive();
      }

      // Keep real-time 60 MB storage widget updated
      const approxBytes = JSON.stringify(messages).length + JSON.stringify(sentMessages || []).length;
      const limitBytes = 60 * 1024 * 1024;
      const usedMb = (approxBytes / (1024 * 1024)).toFixed(2);
      const percent = Math.min(100, Math.round((approxBytes / limitBytes) * 100));
      updateStorageWidget({
        usedBytes: approxBytes,
        limitBytes,
        usedMb: parseFloat(usedMb) < 0.01 ? '0.05' : usedMb,
        limitMb: 60,
        percent: Math.max(1, percent),
        isFull: approxBytes >= limitBytes
      }, gdriveLinkedState);
    }
  } catch(err) {
    console.error('Fetch error:', err);
  }
}

async function fetchSentMessages() {
  if (!currentAccount || !currentAccount.token) return;
  try {
    const res = await fetch('/api/sent', {
      headers: {
        'Authorization': 'Bearer ' + currentAccount.token
      }
    });
    const data = await res.json();
    if (data.success && Array.isArray(data.messages)) {
      sentMessages = data.messages;
      if (sentBadge) {
        sentBadge.textContent = sentMessages.length;
        if (sentMessages.length > 0) sentBadge.classList.remove('hidden');
        else sentBadge.classList.add('hidden');
      }
      if (currentFolder === 'sent') {
        renderMessagesList(getSearchQuery());
      }
    }
  } catch(e) {
    console.warn('Fetch sent error:', e);
  }
}

function renderMessagesList(filterText = '') {
  if (!currentAccount) return;

  const currentList = currentFolder === 'sent' ? sentMessages : messages;

  const filtered = currentList.filter(m => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    const sender = (m.from?.name || m.from?.address || '').toLowerCase();
    const recips = (m.to?.map(t => t.address).join(' ') || '').toLowerCase();
    const sub = (m.subject || '').toLowerCase();
    return sender.includes(q) || recips.includes(q) || sub.includes(q);
  });

  const unreadCount = messages.filter(m => !m.seen).length;
  if (unreadBadge) {
    unreadBadge.textContent = messages.length;
    if (messages.length > 0) {
      unreadBadge.classList.remove('hidden');
    } else {
      unreadBadge.classList.add('hidden');
    }
    if (unreadCount > 0) {
      unreadBadge.classList.add('has-unread');
      unreadBadge.title = `${messages.length} messages (${unreadCount} unread)`;
    } else {
      unreadBadge.classList.remove('has-unread');
      unreadBadge.title = `${messages.length} messages`;
    }
  }

  if (sentBadge) {
    sentBadge.textContent = sentMessages.length;
    if (sentMessages.length > 0) {
      sentBadge.classList.remove('hidden');
    } else {
      sentBadge.classList.add('hidden');
    }
  }

  if (filtered.length === 0) {
    const isSent = currentFolder === 'sent';
    messagesContainer.innerHTML = `
      <div class="empty-state-list">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          ${isSent 
            ? '<line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>'
            : '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>'}
        </svg>
        <h4>${currentList.length === 0 ? (isSent ? 'No sent emails yet' : 'No messages yet') : 'No matching emails'}</h4>
        <p>${currentList.length === 0 ? (isSent ? 'Emails you compose and send will be kept here.' : 'Emails sent to your address will appear here instantly.') : 'Try adjusting your search.'}</p>
      </div>
    `;
    return;
  }

  messagesContainer.innerHTML = '';
  filtered.forEach(msg => {
    const card = document.createElement('div');
    const isSent = currentFolder === 'sent';
    card.className = 'msg-item-card' + (msg.id === activeMessageId ? ' active' : '') + (!msg.seen && !isSent ? ' unread' : '');

    const contactName = isSent 
      ? 'To: ' + (msg.to?.map(t => t.address).join(', ') || 'Recipient')
      : (msg.from?.name || msg.from?.address || 'Unknown');
    const initial = isSent ? '→' : (contactName.charAt(0).toUpperCase() || '?');
    const timeStr = formatHumanTime(msg.createdAt);

    card.innerHTML = `
      <div class="msg-avatar-icon ${isSent ? 'sent-avatar' : ''}">${escapeHtml(initial)}</div>
      <div class="msg-item-details">
        <div class="msg-row-top">
          <span class="msg-from-name" title="${escapeHtml(contactName)}">${escapeHtml(contactName)}</span>
          <div class="msg-time-wrap">
            <span class="msg-time-label">${timeStr}</span>
            ${!msg.seen && !isSent ? '<span class="unread-glow-dot" title="Unread"></span>' : ''}
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

  // 1. Instantly mark as read locally so the dot disappears immediately and persist
  const targetMsg = messages.find(m => m.id === id);
  if (targetMsg && !targetMsg.seen) {
    targetMsg.seen = true;
    saveCachedMessages(currentAccount.address, messages);
  }
  renderMessagesList(getSearchQuery());

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

  // Check 24-hour local storage first for instant rendering without waiting
  const cachedMsg = loadCachedMessageBody(currentAccount.address, id);
  if (cachedMsg) {
    renderMessageDetails(cachedMsg);
  } else {
    readerSubject.textContent = 'Loading message...';
    senderName.textContent = '...';
    senderEmail.textContent = '';
    recipientAddress.textContent = currentAccount.address;
    messageDate.textContent = '...';
  }

  try {
    const res = await fetch(`/api/messages/${id}`, {
      headers: { 'Authorization': 'Bearer ' + currentAccount.token }
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const msg = data.message;
    // Persist full message to 24h local storage
    saveCachedMessageBody(currentAccount.address, id, msg);
    renderMessageDetails(msg);

  } catch(err) {
    if (!cachedMsg) {
      readerSubject.textContent = 'Error loading message';
      textPreviewBody.textContent = err.message;
    }
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
      sentMessages = sentMessages.filter(m => m.id !== id);
      saveCachedMessages(currentAccount.address, messages);
      syncMailboxToGoogleDrive(true);
      try {
        localStorage.removeItem(getCacheKeyBody(currentAccount.address, id));
      } catch(e) {}
      activeMessageId = null;
      renderMessagesList(getSearchQuery());
      readerPane.classList.add('hidden');
      readerPlaceholder.classList.remove('hidden');
    }
  } catch(err) {
    alert('Failed to delete: ' + err.message);
  }
}

function triggerManualRefresh() {
  manualRefreshIcon.style.animation = 'spin 1s linear infinite';
  const p = currentFolder === 'sent' ? fetchSentMessages() : fetchMessages();
  p.then(() => {
    setTimeout(() => {
      manualRefreshIcon.style.animation = '';
      showToast('Checked for new messages');
    }, 600);
  });
}

let lastUserActivity = Date.now();
['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
  window.addEventListener(evt, () => { lastUserActivity = Date.now(); }, { passive: true });
});

let syncTimerId = null;

function startSyncLoop() {
  stopSyncLoop();
  if (!currentAccount) return;

  // Immediate fetch upon activating session
  fetchMessages();

  function scheduleNext() {
    if (!currentAccount) return;
    const isIdle = (Date.now() - lastUserActivity) > 60000; // 1 min without interaction
    const delay = isIdle ? 8000 : 4000;

    syncTimerId = setTimeout(async () => {
      if (!currentAccount) return;
      if (document.visibilityState === 'visible') {
        await fetchMessages();
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

function stopSyncLoop() {
  if (syncTimerId) {
    clearTimeout(syncTimerId);
    syncTimerId = null;
  }
}

// Immediately refresh when tab is focused
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentAccount) {
    fetchMessages();
  }
});

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

function linkify(text) {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
  return text.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

function decodeQuotedPrintable(input) {
  if (typeof input !== 'string') return input;
  const normalized = input.replace(/=(?:\r\n|\r|\n)/g, '');
  try {
    const percentEncoded = normalized
      .replace(/%/g, '%25')
      .replace(/=([0-9A-Fa-f]{2})/g, '%$1');
    return decodeURIComponent(percentEncoded);
  } catch (e) {
    return normalized.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
  }
}

function prepareEmailHtml(rawHtml) {
  if (!rawHtml) return '';

  let processed = rawHtml;
  if (/(?:=09|=3D|=\r?\n|=E2=80=8B)/i.test(processed)) {
    processed = decodeQuotedPrintable(processed);
  }

  // 1. Inject <base target="_blank"> and responsive typography styles
  const baseTag = '<base target="_blank">';
  const defaultStyles = `
    <style>
      body {
        margin: 0;
        padding: 24px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        line-height: 1.6;
        color: #1e293b;
        background-color: #ffffff;
        box-sizing: border-box;
        word-break: break-word;
      }
      img {
        max-width: 100% !important;
        height: auto !important;
      }
      table {
        max-width: 100% !important;
      }
      pre {
        white-space: pre-wrap !important;
        word-break: break-word !important;
        font-family: inherit !important;
      }
    </style>
  `;

  // 2. Client script inside iframe to guarantee all anchor clicks open in a new tab
  const clickScript = `
    <script>
      (function() {
        function enforceNewTab() {
          var links = document.getElementsByTagName('a');
          for (var i = 0; i < links.length; i++) {
            links[i].setAttribute('target', '_blank');
            links[i].setAttribute('rel', 'noopener noreferrer');
          }
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', enforceNewTab);
        } else {
          enforceNewTab();
        }
        document.addEventListener('click', function(e) {
          var a = e.target.closest ? e.target.closest('a') : null;
          if (a && a.href && !a.href.startsWith('javascript:')) {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
          }
        }, true);
      })();
    <\/script>
  `;

  const injectedHead = `${baseTag}${defaultStyles}${clickScript}`;

  if (/<head[^>]*>/i.test(processed)) {
    processed = processed.replace(/<head[^>]*>/i, `$&${injectedHead}`);
  } else if (/<html[^>]*>/i.test(processed)) {
    processed = processed.replace(/<html[^>]*>/i, `$&<head>${injectedHead}</head>`);
  } else {
    processed = `<!DOCTYPE html><html><head>${injectedHead}</head><body>${processed}</body></html>`;
  }

  // Also replace any existing target="_self" or target="_parent" or target="_top" with target="_blank"
  processed = processed.replace(/target\s*=\s*["'](?:_self|_parent|_top)["']/gi, 'target="_blank"');

  return processed;
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

// ==========================================================================
// GOOGLE DRIVE & 60 MB STORAGE QUOTA MANAGEMENT (CROSS-DEVICE SYNC)
// ==========================================================================
const GOOGLE_CLIENT_ID = '112999651074-u3dc2tp4m1ofsig3h2mupv0348noshdp.apps.googleusercontent.com';
let gdriveLinkedState = false;
let mailboxStorageData = {
  usedBytes: 0,
  limitBytes: 60 * 1024 * 1024,
  usedMb: '0.05',
  percent: 1,
  isFull: false
};

async function checkGoogleDriveStatus() {
  if (!currentAccount) return;

  let isLinked = !!currentAccount.gdriveLinked || !!currentAccount.driveFileId;

  if (currentAccount.token) {
    try {
      const res = await fetch('/api/gdrive/status', {
        headers: { 'Authorization': `Bearer ${currentAccount.token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          isLinked = !!data.linked;
          if (data.storage) {
            mailboxStorageData = data.storage;
          }
          if (data.gdrive) {
            if (data.gdrive.driveEmail) currentAccount.driveEmail = data.gdrive.driveEmail;
            if (data.gdrive.webViewLink) currentAccount.webViewLink = data.gdrive.webViewLink;
            if (data.gdrive.fileId) currentAccount.driveFileId = data.gdrive.fileId;
            currentAccount.gdriveLinked = true;
            saveRecentAccount(currentAccount);
            localStorage.setItem('mailtm_current_account', JSON.stringify(currentAccount));
          }
        }
      }
    } catch(e) {
      console.warn('Backend gdrive status fetch error:', e);
    }
  }

  gdriveLinkedState = isLinked;
  currentAccount.gdriveLinked = isLinked;
  updateStorageWidget(mailboxStorageData, isLinked);

  // If already linked, NEVER show the mandatory modal
  if (!isLinked) {
    showMandatoryGDriveModal();
  } else {
    if (gdriveModal) {
      gdriveModal.classList.add('hidden');
      gdriveModal.style.display = 'none';
    }
    // Auto-update Google Drive database on session load
    syncMailboxToGoogleDrive();
  }
}

function showMandatoryGDriveModal() {
  if (!currentAccount || !gdriveModal) return;
  // If account has already connected Google Drive, NEVER show this modal!
  if (currentAccount.gdriveLinked || gdriveLinkedState || currentAccount.driveFileId) {
    gdriveModal.classList.add('hidden');
    gdriveModal.style.display = 'none';
    return;
  }
  if (gdriveMailboxAddress) {
    gdriveMailboxAddress.textContent = currentAccount.address;
  }
  gdriveModal.classList.remove('hidden');
  gdriveModal.style.display = 'flex';
}

function updateStorageWidget(storage, isLinked) {
  if (!storage) return;

  if (storageUsedText) {
    storageUsedText.textContent = `${storage.usedMb} MB / 60 MB`;
  }

  if (storageProgressBar) {
    const pct = Math.max(2, Math.min(100, storage.percent));
    storageProgressBar.style.width = pct + '%';
    
    storageProgressBar.classList.remove('warn', 'full');
    if (pct >= 95) {
      storageProgressBar.classList.add('full');
    } else if (pct >= 80) {
      storageProgressBar.classList.add('warn');
    }
  }

  if (gdriveStatusText) {
    gdriveStatusText.textContent = isLinked ? 'Drive Active' : 'Drive Pending';
  }

  if (gdriveStatusPill) {
    gdriveStatusPill.style.color = isLinked ? '#34D399' : '#F59E0B';
  }

  // Display which Google Account is linked
  const linkedGmail = (currentAccount && currentAccount.driveEmail) ? currentAccount.driveEmail : (isLinked ? 'Connected' : 'Not Linked');
  if (storageLinkedEmail) {
    storageLinkedEmail.textContent = linkedGmail;
    storageLinkedEmail.title = isLinked ? `Linked Google Account: ${linkedGmail}` : 'Google Drive not linked';
  }
  if (dropdownGdriveEmail) {
    dropdownGdriveEmail.textContent = linkedGmail;
  }

  // Open in Google Drive Link
  const driveLink = (currentAccount && currentAccount.webViewLink) ? currentAccount.webViewLink : (currentAccount && currentAccount.driveFileId ? `https://drive.google.com/file/d/${currentAccount.driveFileId}/view` : 'https://drive.google.com');
  if (btnOpenDriveFile) {
    if (isLinked) {
      btnOpenDriveFile.href = driveLink;
      btnOpenDriveFile.style.display = 'inline-flex';
    } else {
      btnOpenDriveFile.style.display = 'none';
    }
  }
  if (dropdownDriveViewLink) {
    if (isLinked) {
      dropdownDriveViewLink.href = driveLink;
      dropdownDriveViewLink.style.display = 'inline-flex';
    } else {
      dropdownDriveViewLink.style.display = 'none';
    }
  }

  // Handle storage full condition
  if (storage.isFull && composeSubmitBtn) {
    composeSubmitBtn.disabled = true;
    composeSubmitBtn.title = 'Storage full (60 MB limit). Delete older emails to send new messages.';
  }
}

// Google Drive Token & Instant Auto-Update Engine
function saveActiveGoogleToken(token) {
  if (!token) return;
  window.activeGoogleToken = token;
  const now = Date.now();
  try {
    if (currentAccount && currentAccount.address) {
      localStorage.setItem('mailflux_gtoken_' + currentAccount.address, token);
      localStorage.setItem('mailflux_gtime_' + currentAccount.address, String(now));
      sessionStorage.setItem('mailflux_gtoken_' + currentAccount.address, token);
    }
    localStorage.setItem('mailflux_last_gtoken', token);
    localStorage.setItem('mailflux_last_gtime', String(now));
    sessionStorage.setItem('mailflux_last_gtoken', token);
  } catch(e) {}
}

function getActiveGoogleToken() {
  if (window.activeGoogleToken) return window.activeGoogleToken;
  try {
    let saved = null;
    let savedTime = null;
    if (currentAccount && currentAccount.address) {
      saved = localStorage.getItem('mailflux_gtoken_' + currentAccount.address) || 
              sessionStorage.getItem('mailflux_gtoken_' + currentAccount.address);
      savedTime = localStorage.getItem('mailflux_gtime_' + currentAccount.address);
    }
    if (!saved) {
      saved = localStorage.getItem('mailflux_last_gtoken') || sessionStorage.getItem('mailflux_last_gtoken');
      savedTime = localStorage.getItem('mailflux_last_gtime');
    }
    if (saved) {
      window.activeGoogleToken = saved;
      return saved;
    }
  } catch(e) {}
  return null;
}

async function ensureGoogleToken(allowInteractive = false) {
  let token = getActiveGoogleToken();
  if (token) return token;

  if (window.google && google.accounts && google.accounts.oauth2 && currentAccount) {
    try {
      token = await new Promise((resolve) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
          hint: currentAccount.driveEmail || undefined,
          prompt: allowInteractive ? 'select_account' : '',
          callback: (resp) => {
            if (resp && resp.access_token) {
              saveActiveGoogleToken(resp.access_token);
              resolve(resp.access_token);
            } else {
              resolve(null);
            }
          }
        });
        client.requestAccessToken({ prompt: allowInteractive ? 'select_account' : '' });
      });
      return token;
    } catch(e) {
      console.warn('Silent token check notice:', e);
      return null;
    }
  }
  return null;
}

let isDriveSyncing = false;
let lastSyncedEmailsCount = -1;

async function syncMailboxToGoogleDrive(force = false) {
  if (!currentAccount || isDriveSyncing) return;
  if (!currentAccount.gdriveLinked && !gdriveLinkedState && !currentAccount.driveFileId) return;

  const currentCount = messages ? messages.length : 0;
  const totalCount = currentCount + (sentMessages ? sentMessages.length : 0);
  if (!force && totalCount === lastSyncedEmailsCount) return;

  const token = await ensureGoogleToken(false);
  if (!token) {
    console.warn('Google Drive auto-sync waiting for active token. Click Sync to refresh.');
    return;
  }

  isDriveSyncing = true;
  try {
    const dbPayload = {
      mailbox: currentAccount.address,
      lastUpdated: new Date().toISOString(),
      linkedGoogleAccount: currentAccount.driveEmail || 'Google Account',
      storageLimitMb: 60,
      messagesCount: currentCount,
      totalEmails: totalCount,
      inboxCount: currentCount,
      sentCount: sentMessages ? sentMessages.length : 0,
      messages: (messages || []).map(m => ({
        id: m.id,
        from: m.from,
        to: m.to,
        subject: m.subject,
        intro: m.intro,
        seen: m.seen,
        createdAt: m.createdAt,
        timestamp: m.timestamp
      })),
      inbox: (messages || []).map(m => ({
        id: m.id,
        from: m.from,
        to: m.to,
        subject: m.subject,
        intro: m.intro,
        seen: m.seen,
        createdAt: m.createdAt,
        timestamp: m.timestamp
      })),
      sent: (sentMessages || []).map(s => ({
        id: s.id,
        from: s.from,
        to: s.to,
        subject: s.subject,
        intro: s.intro,
        seen: s.seen,
        createdAt: s.createdAt,
        timestamp: s.timestamp
      }))
    };

    let fileId = currentAccount.driveFileId;
    let needsCreate = !fileId || fileId.startsWith('gdrive_db_');

    if (!needsCreate) {
      const patchRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dbPayload, null, 2)
      });

      if (patchRes.ok) {
        lastSyncedEmailsCount = totalCount;
        console.log(`✅ Google Drive successfully updated with ${currentCount} emails! (file: ${fileId})`);
        showToast(`☁️ Google Drive updated: ${currentCount} emails synced`);
        return;
      }

      if (patchRes.status === 404 || patchRes.status === 403) {
        needsCreate = true;
      }
    }

    if (needsCreate) {
      const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: `mailflux_${currentAccount.address.replace(/[@.]/g, '_')}_db.json`,
          mimeType: 'application/json',
          description: `MailFlux 60 MB Persistent Mailbox Database for ${currentAccount.address}`
        })
      });

      if (createRes.ok) {
        const fileData = await createRes.json();
        if (fileData && fileData.id) {
          fileId = fileData.id;
          currentAccount.driveFileId = fileId;
          currentAccount.webViewLink = `https://drive.google.com/file/d/${fileId}/view`;
          currentAccount.gdriveLinked = true;
          gdriveLinkedState = true;
          saveRecentAccount(currentAccount);
          localStorage.setItem('mailtm_current_account', JSON.stringify(currentAccount));

          await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(dbPayload, null, 2)
          });

          await fetch('/api/gdrive/link', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentAccount.token}`
            },
            body: JSON.stringify({
              driveEmail: currentAccount.driveEmail,
              fileId,
              webViewLink: currentAccount.webViewLink
            })
          });

          lastSyncedEmailsCount = totalCount;
          showToast(`☁️ Google Drive database created and updated (${currentCount} emails)`);
        }
      }
    }
  } catch(syncErr) {
    console.warn('Google Drive auto-sync error:', syncErr);
  } finally {
    isDriveSyncing = false;
  }
}

async function triggerDriveSync() {
  if (!currentAccount) return;
  if (btnSyncDrive) btnSyncDrive.textContent = '...';
  try {
    await fetchMessages();
    await fetchSentMessages();
    let token = await ensureGoogleToken(true);
    if (token) {
      await syncMailboxToGoogleDrive(true);
    } else {
      showToast('Connecting Google Drive...');
      await connectGoogleDriveAccount();
    }
  } catch(e) {
    console.error('Manual drive sync error:', e);
    showToast('Sync notice: ' + (e.message || ''));
  } finally {
    if (btnSyncDrive) btnSyncDrive.textContent = 'Sync';
  }
}

async function connectGoogleDriveAccount() {
  if (!currentAccount) return;

  if (btnConnectGoogleDriveText) {
    btnConnectGoogleDriveText.textContent = 'Connecting...';
  }
  if (btnConnectGoogleDrive) {
    btnConnectGoogleDrive.disabled = true;
  }

  try {
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      throw new Error('Google Identity Services SDK is loading. Please try again in 3 seconds.');
    }

    const tokenResponse = await new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
        enable_granular_consent: false,
        hint: currentAccount.driveEmail || undefined,
        callback: (resp) => {
          if (resp.error) {
            reject(new Error(resp.error_description || resp.error || 'Google authorization cancelled.'));
            return;
          }
          resolve(resp);
        }
      });
      client.requestAccessToken({ prompt: 'consent' });
    });

    const accessToken = tokenResponse.access_token;
    if (!accessToken) throw new Error('Failed to obtain Google access token.');
    saveActiveGoogleToken(accessToken);

    const hasDriveScope = (tokenResponse.scope && tokenResponse.scope.includes('drive')) || 
      (window.google && google.accounts && google.accounts.oauth2 && google.accounts.oauth2.hasGrantedAllScopes && google.accounts.oauth2.hasGrantedAllScopes(tokenResponse, 'https://www.googleapis.com/auth/drive.file'));

    if (!hasDriveScope) {
      throw new Error('Please check the box for Google Drive permission in the Google popup.');
    }

    let driveEmail = currentAccount.driveEmail || 'Google Account';
    try {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (userRes.ok) {
        const uProfile = await userRes.json();
        if (uProfile && uProfile.email) {
          driveEmail = uProfile.email;
        }
      }
    } catch(e) {
      console.warn('Error fetching Google user profile:', e);
    }

    let fileId = currentAccount.driveFileId;
    let webViewLink = currentAccount.webViewLink || 'https://drive.google.com';

    const currentCount = messages ? messages.length : 0;
    const totalCount = currentCount + (sentMessages ? sentMessages.length : 0);
    const dbPayload = {
      mailbox: currentAccount.address,
      createdAt: new Date().toISOString(),
      linkedGoogleAccount: driveEmail,
      storageLimitMb: 60,
      messagesCount: currentCount,
      totalEmails: totalCount,
      inboxCount: currentCount,
      sentCount: sentMessages ? sentMessages.length : 0,
      messages: (messages || []).slice(0, 100),
      inbox: (messages || []).slice(0, 100),
      sent: (sentMessages || []).slice(0, 100)
    };

    if (!fileId || fileId.startsWith('gdrive_db_')) {
      const meta = {
        name: `mailflux_${currentAccount.address.replace(/[@.]/g, '_')}_db.json`,
        mimeType: 'application/json',
        description: `MailFlux 60 MB Persistent Mailbox Database for ${currentAccount.address}`
      };

      const driveCreateRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(meta)
      });

      if (!driveCreateRes.ok) {
        const errData = await driveCreateRes.json().catch(() => ({}));
        const errDetail = (errData.error && errData.error.message) ? errData.error.message : ('HTTP ' + driveCreateRes.status);
        console.error('Google Drive API error:', errData);
        throw new Error(`Google Drive API: ${errDetail}`);
      }

      const fileData = await driveCreateRes.json();
      if (!fileData || !fileData.id) {
        throw new Error('Google Drive did not return a valid file ID.');
      }

      fileId = fileData.id;
      webViewLink = `https://drive.google.com/file/d/${fileId}/view`;
    }

    const patchRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dbPayload, null, 2)
    });

    if (!patchRes.ok) {
      console.warn('Drive content PATCH warning:', patchRes.status);
    }
    console.log('✅ Real Google Drive file updated successfully. File ID:', fileId, 'Link:', webViewLink);

    try {
      await fetch('/api/gdrive/link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentAccount.token}`
        },
        body: JSON.stringify({
          driveEmail,
          fileId,
          webViewLink
        })
      });
    } catch(err) {
      console.warn('Backend link sync notice:', err);
    }

    gdriveLinkedState = true;
    currentAccount.gdriveLinked = true;
    currentAccount.driveEmail = driveEmail;
    currentAccount.webViewLink = webViewLink;
    currentAccount.driveFileId = fileId;
    saveRecentAccount(currentAccount);
    localStorage.setItem('mailtm_current_account', JSON.stringify(currentAccount));

    if (gdriveModal) {
      gdriveModal.classList.add('hidden');
      gdriveModal.style.display = 'none';
    }

    showToast(`🎉 Google Drive connected (${driveEmail})! 60 MB database synced.`);

    updateStorageWidget(mailboxStorageData, true);
    await syncMailboxToGoogleDrive(true);

  } catch(err) {
    console.error('Google Drive link error:', err);
    showToast(err.message || 'Failed to connect Google Drive');
  } finally {
    if (btnConnectGoogleDriveText) {
      btnConnectGoogleDriveText.textContent = 'Connect with Google';
    }
    if (btnConnectGoogleDrive) {
      btnConnectGoogleDrive.disabled = false;
    }
  }
}

// --------------------------------------------------------------------------
// PASSWORD RECOVERY SYSTEM (GOOGLE 1-CLICK OR EMAIL OTP)
// --------------------------------------------------------------------------
const recoveryModal = document.getElementById('recoveryModal');
const recoveryCloseBtn = document.getElementById('recoveryCloseBtn');
const recStep1 = document.getElementById('recStep1');
const recStep2 = document.getElementById('recStep2');
const recStep3 = document.getElementById('recStep3');
const recMailboxInput = document.getElementById('recMailboxInput');
const btnRecFindAccount = document.getElementById('btnRecFindAccount');
const recMaskedEmail = document.getElementById('recMaskedEmail');
const btnRecVerifyGoogle = document.getElementById('btnRecVerifyGoogle');
const btnRecSendOtp = document.getElementById('btnRecSendOtp');
const btnRecSendOtpText = document.getElementById('btnRecSendOtpText');
const recOtpSection = document.getElementById('recOtpSection');
const recOtpInput = document.getElementById('recOtpInput');
const btnRecVerifyOtp = document.getElementById('btnRecVerifyOtp');
const recNewPassword = document.getElementById('recNewPassword');
const btnRecSubmitNewPass = document.getElementById('btnRecSubmitNewPass');

let recMailbox = '';
let recMethod = '';
let recGoogleToken = '';
let recOtp = '';

function openRecoveryModal(prefillEmail = '') {
  if (!recoveryModal) return;

  recMailbox = '';
  recMethod = '';
  recGoogleToken = '';
  recOtp = '';

  if (recStep1) { recStep1.classList.remove('hidden'); recStep1.classList.add('active'); }
  if (recStep2) { recStep2.classList.add('hidden'); recStep2.classList.remove('active'); }
  if (recStep3) { recStep3.classList.add('hidden'); recStep3.classList.remove('active'); }
  if (recOtpSection) recOtpSection.classList.add('hidden');

  if (recMailboxInput) {
    recMailboxInput.value = prefillEmail || '';
    setTimeout(() => recMailboxInput.focus(), 80);
  }

  recoveryModal.classList.remove('hidden');
}

function closeRecoveryModal() {
  if (recoveryModal) recoveryModal.classList.add('hidden');
}

if (recoveryCloseBtn) {
  recoveryCloseBtn.addEventListener('click', closeRecoveryModal);
}

if (recoveryModal) {
  recoveryModal.addEventListener('click', (e) => {
    if (e.target === recoveryModal) closeRecoveryModal();
  });
}

// Step 1: Find Account
if (btnRecFindAccount) {
  btnRecFindAccount.addEventListener('click', async () => {
    const address = recMailboxInput ? recMailboxInput.value.trim() : '';
    if (!address || !address.includes('@')) {
      showToast('Please enter a valid MailFlux address.');
      return;
    }

    btnRecFindAccount.disabled = true;
    btnRecFindAccount.textContent = 'Searching...';

    try {
      const res = await fetch('/api/auth/recovery-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Mailbox not found.');
      }

      recMailbox = data.address;
      if (recMaskedEmail) recMaskedEmail.textContent = data.maskedEmail;

      // Switch to Step 2
      recStep1.classList.add('hidden');
      recStep1.classList.remove('active');
      recStep2.classList.remove('hidden');
      recStep2.classList.add('active');

      showToast(`Found mailbox! Recovery linked to ${data.maskedEmail}`);

    } catch(err) {
      showToast(err.message || 'Failed to find account.');
    } finally {
      btnRecFindAccount.disabled = false;
      btnRecFindAccount.innerHTML = '<span>Find Account</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
    }
  });
}

// Step 2, Option A: Verify Identity with Google (1-Click)
if (btnRecVerifyGoogle) {
  btnRecVerifyGoogle.addEventListener('click', async () => {
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      showToast('Google Identity Services is loading. Please try again in 2 seconds.');
      return;
    }

    try {
      const tokenResp = await new Promise((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'https://www.googleapis.com/auth/userinfo.email',
          callback: (resp) => {
            if (resp.error) return reject(new Error(resp.error_description || resp.error || 'Google sign-in cancelled'));
            resolve(resp);
          }
        });
        client.requestAccessToken({ prompt: 'select_account' });
      });

      if (!tokenResp.access_token) throw new Error('Failed to obtain token from Google');

      recMethod = 'google';
      recGoogleToken = tokenResp.access_token;

      // Proceed to Step 3: Set New Password
      recStep2.classList.add('hidden');
      recStep2.classList.remove('active');
      recStep3.classList.remove('hidden');
      recStep3.classList.add('active');

      showToast('✅ Google Identity verified! Now choose your new password.');
      setTimeout(() => recNewPassword && recNewPassword.focus(), 100);

    } catch(e) {
      showToast(e.message || 'Google verification failed.');
    }
  });
}

// Step 2, Option B: Send 6-Digit OTP via Brevo
if (btnRecSendOtp) {
  btnRecSendOtp.addEventListener('click', async () => {
    if (!recMailbox) return;

    btnRecSendOtp.disabled = true;
    if (btnRecSendOtpText) btnRecSendOtpText.textContent = 'Sending code...';

    try {
      const res = await fetch('/api/auth/send-recovery-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: recMailbox })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to send verification code.');

      if (recOtpSection) {
        recOtpSection.classList.remove('hidden');
        if (recOtpInput) setTimeout(() => recOtpInput.focus(), 100);
      }
      showToast(`📨 6-digit code sent to ${data.maskedEmail}!`);

    } catch(err) {
      showToast(err.message || 'Failed to send code.');
    } finally {
      btnRecSendOtp.disabled = false;
      if (btnRecSendOtpText) btnRecSendOtpText.textContent = 'Resend Code';
    }
  });
}

// Step 2, Verify OTP
if (btnRecVerifyOtp) {
  btnRecVerifyOtp.addEventListener('click', () => {
    const otp = recOtpInput ? recOtpInput.value.trim() : '';
    if (otp.length < 6) {
      showToast('Please enter the full 6-digit verification code.');
      return;
    }

    recMethod = 'otp';
    recOtp = otp;

    // Proceed to Step 3
    recStep2.classList.add('hidden');
    recStep2.classList.remove('active');
    recStep3.classList.remove('hidden');
    recStep3.classList.add('active');

    showToast('Code entered! Set your new password.');
    setTimeout(() => recNewPassword && recNewPassword.focus(), 100);
  });
}

// Step 3: Submit New Password
if (btnRecSubmitNewPass) {
  btnRecSubmitNewPass.addEventListener('click', async () => {
    const newPass = recNewPassword ? recNewPassword.value.trim() : '';
    if (newPass.length < 6) {
      showToast('Password must be at least 6 characters.');
      return;
    }

    btnRecSubmitNewPass.disabled = true;
    btnRecSubmitNewPass.textContent = 'Updating password...';

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: recMailbox,
          newPassword: newPass,
          method: recMethod,
          googleToken: recGoogleToken,
          otp: recOtp
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Password reset failed.');
      }

      // Success: Save new account session and log user in automatically!
      currentAccount = data.account;
      saveRecentAccount(currentAccount);
      localStorage.setItem('mailtm_current_account', JSON.stringify(currentAccount));

      closeRecoveryModal();
      if (window.closeModal) window.closeModal();

      renderActiveSession();
      startSyncLoop();

      showToast('🎉 Password reset successfully! You are now logged in.');

    } catch(err) {
      showToast(err.message || 'Failed to reset password.');
    } finally {
      btnRecSubmitNewPass.disabled = false;
      btnRecSubmitNewPass.innerHTML = '<span>Set New Password & Sign In</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
    }
  });
}

