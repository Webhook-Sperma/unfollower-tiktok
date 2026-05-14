// ─── State ────────────────────────────────────────────────────────────────────
let currentDelay = 1500;
let isRunning = false;

// ─── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startUnfollow') {
    if (isRunning) {
      sendResponse({ success: false, error: 'Already running' });
      return false;
    }
    if (request.delay) currentDelay = request.delay;

    isRunning = true;
    autoUnfollow(request.unfollowFollowing, request.unfollowFriend)
      .then((result) => {
        isRunning = false;
        sendResponse(result);
      })
      .catch((error) => {
        isRunning = false;
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'setSpeed') {
    currentDelay = request.delay;
  }
});

// ─── Messaging helpers ────────────────────────────────────────────────────────
function send(msg) {
  try { chrome.runtime.sendMessage(msg); } catch (_) {}
}

// ─── Scroll to load all accounts ──────────────────────────────────────────────
async function autoScrollToLoadAll(maxScrolls = 60, delay = 400) {
  send({ action: 'phase', phase: 'scrolling', message: 'Scrolling to load all accounts...' });

  // Find the deepest scrollable container visible in the viewport
  function findScrollContainer() {
    const selectors = [
      '[data-e2e="follow-info-popup"]',
      '[data-e2e="scroll-list"]',
      '[data-e2e="recommended-user-list"]',
      '[role="dialog"]',
      '[class*="DivUserListWrapper"]',
      '[class*="follower"]',
      '[class*="following"]',
      '[class*="modal"]',
      '[class*="scroll"]',
    ];

    for (const sel of selectors) {
      try {
        const els = [...document.querySelectorAll(sel)];
        const scrollable = els.find(el => el.scrollHeight > el.clientHeight + 10);
        if (scrollable) return scrollable;
      } catch (_) {}
    }

    // Fallback: walk DOM for scrollable divs
    const all = document.querySelectorAll('div');
    for (const el of all) {
      const style = window.getComputedStyle(el);
      const overflow = style.overflowY;
      if ((overflow === 'scroll' || overflow === 'auto') && el.scrollHeight > el.clientHeight + 20) {
        return el;
      }
    }

    return null;
  }

  const container = findScrollContainer();
  let scrollCount = 0;
  let stableCount = 0;
  const STABLE_THRESHOLD = 3; // stop if height hasn't changed for 3 iterations

  return new Promise((resolve) => {
    let lastHeight = container ? container.scrollHeight : document.documentElement.scrollHeight;

    const tick = () => {
      if (container) {
        container.scrollTop = container.scrollHeight;
      } else {
        window.scrollTo(0, document.documentElement.scrollHeight);
      }

      scrollCount++;

      setTimeout(() => {
        const newHeight = container ? container.scrollHeight : document.documentElement.scrollHeight;

        if (newHeight === lastHeight) {
          stableCount++;
        } else {
          stableCount = 0;
          lastHeight = newHeight;
        }

        if (stableCount >= STABLE_THRESHOLD || scrollCount >= maxScrolls) {
          resolve(container);
        } else {
          tick();
        }
      }, delay);
    };

    tick();
  });
}

// ─── Wait for a confirmation dialog and dismiss it ────────────────────────────
function dismissConfirmDialog(timeout = 2000) {
  return new Promise((resolve) => {
    const start = Date.now();

    const check = () => {
      // TikTok's unfollow confirm button selectors
      const confirmSelectors = [
        '[data-e2e="confirm-unfollow-btn"]',
        'button[class*="Confirm"]',
        '[class*="confirm"] button',
        '[class*="Unfollow"] button',
      ];

      for (const sel of confirmSelectors) {
        try {
          const btn = document.querySelector(sel);
          if (btn && btn.innerText && btn.innerText.trim().length > 0) {
            btn.click();
            resolve(true);
            return;
          }
        } catch (_) {}
      }

      // Also look for any visible button with "Unfollow" text in a dialog
      const allBtns = [...document.querySelectorAll('button')];
      for (const btn of allBtns) {
        const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (text === 'unfollow' && btn.getBoundingClientRect().width > 0) {
          btn.click();
          resolve(true);
          return;
        }
      }

      if (Date.now() - start < timeout) {
        setTimeout(check, 100);
      } else {
        resolve(false);
      }
    };

    setTimeout(check, 300);
  });
}

// ─── Collect follow buttons ────────────────────────────────────────────────────
function collectButtons(unfollowFollowing, unfollowFriend) {
  const seen = new Set();
  const followingButtons = [];
  const friendButtons = [];

  function isVisible(el) {
    try {
      const rect = el.getBoundingClientRect();
      if (!rect.width && !rect.height) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    } catch (_) {
      return false;
    }
  }

  // Broad selector sweep
  const selectors = [
    '[data-e2e*="follow"]',
    'button[aria-label*="follow" i]',
    'button[aria-label*="following" i]',
    'button[aria-label*="friend" i]',
    'button',
    '[role="button"]',
  ];

  for (const sel of selectors) {
    try {
      document.querySelectorAll(sel).forEach(el => {
        if (seen.has(el) || !(el instanceof Element)) return;
        seen.add(el);

        if (!isVisible(el)) return;

        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const combined = text + ' ' + ariaLabel;

        const isFollowing = /\bfollowing\b|\bunfollow\b/.test(combined);
        const isFriend = /\bfriend(s)?\b|\bremove\b/.test(combined) && !isFollowing;

        if (unfollowFollowing && isFollowing) followingButtons.push(el);
        else if (unfollowFriend && isFriend) friendButtons.push(el);
      });
    } catch (_) {}
  }

  return { followingButtons, friendButtons };
}

// ─── Main unfollow routine ─────────────────────────────────────────────────────
async function autoUnfollow(unfollowFollowing = true, unfollowFriend = false) {
  // Step 1: Scroll
  await autoScrollToLoadAll(60, 400);

  // Step 2: Scan
  send({ action: 'phase', phase: 'scanning', message: 'Scanning for follow buttons...' });
  await sleep(500);

  const { followingButtons, friendButtons } = collectButtons(unfollowFollowing, unfollowFriend);
  const buttons = [...followingButtons, ...friendButtons];

  if (buttons.length === 0) {
    send({ action: 'phase', phase: 'error', message: 'No follow buttons found. Are you on the Following tab?' });
    return { success: false, count: 0, message: 'No buttons found.' };
  }

  send({
    action: 'totalFound',
    count: buttons.length,
    followingCount: followingButtons.length,
    friendCount: friendButtons.length
  });

  // Step 3: Unfollow
  let followingUnfollowed = 0;
  let friendUnfollowed = 0;

  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];

    // Skip if button is no longer in DOM or text changed (already unfollowed)
    if (!document.contains(btn)) continue;
    const currentText = (btn.innerText || btn.textContent || '').trim().toLowerCase();
    if (!currentText || currentText === 'follow') continue;

    const isFollowingBtn = i < followingButtons.length;

    try {
      btn.click();
    } catch (_) {
      try {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      } catch (_) {}
    }

    // Handle potential confirm dialog (TikTok sometimes shows one)
    await dismissConfirmDialog(1500);

    if (isFollowingBtn) followingUnfollowed++;
    else friendUnfollowed++;

    send({
      action: 'progress',
      count: i + 1,
      followingCount: followingUnfollowed,
      friendCount: friendUnfollowed
    });

    await sleep(currentDelay);
  }

  const total = followingUnfollowed + friendUnfollowed;
  send({
    action: 'done',
    count: total,
    followingCount: followingUnfollowed,
    friendCount: friendUnfollowed
  });

  return { success: true, count: total, message: 'Done.' };
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}