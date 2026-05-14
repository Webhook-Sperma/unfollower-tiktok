const mainBtn = document.getElementById('mainBtn');
const btnText = document.getElementById('btnText');
const statusMsg = document.getElementById('statusMsg');
const phaseBadge = document.getElementById('phaseBadge');
const statTotal = document.getElementById('statTotal');
const statDone = document.getElementById('statDone');
const statFriend = document.getElementById('statFriend');
const barFill = document.getElementById('barFill');
const progressLabel = document.getElementById('progressLabel');
const progressPct = document.getElementById('progressPct');

let state = {
  following: true,
  friend: false,
  speed: 1500,
  running: false,
  total: 0
};

function toggleOption(type) {
  if (state.running) return;
  state[type] = !state[type];
  const tog = document.getElementById('tog-' + type);
  const opt = document.getElementById('opt-' + type);
  tog.className = 'toggle' + (state[type] ? (type === 'friend' ? ' on pink' : ' on') : '');
  opt.className = 'option' + (state[type] ? ' active' : '');
}

function setSpeed(ms) {
  state.speed = ms;
  document.querySelectorAll('.pill').forEach(p => {
    p.className = 'pill' + (parseInt(p.dataset.speed) === ms ? ' active' : '');
  });
  // Notify content script of speed change if running
  if (state.running) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'setSpeed', delay: ms });
    });
  }
  // Update footer label
  const delayEl = document.querySelector('.footer span');
  const labels = { 800: '0.8s delay', 1500: '1.5s delay', 3000: '3s delay' };
  if (delayEl) delayEl.textContent = labels[ms] || ms + 'ms delay';
}

function setPhase(phase) {
  const labels = {
    idle:        { text: 'idle',        cls: 'idle' },
    scrolling:   { text: 'scrolling',   cls: 'scrolling' },
    scanning:    { text: 'scanning',    cls: 'scanning' },
    unfollowing: { text: 'running',     cls: 'unfollowing' },
    done:        { text: 'done',        cls: 'done' },
    error:       { text: 'error',       cls: 'unfollowing' }
  };
  const p = labels[phase] || labels.idle;
  phaseBadge.innerHTML = `<span class="phase ${p.cls}"><span class="phase-dot"></span>${p.text}</span>`;
}

function setStatus(msg, type = '') {
  statusMsg.textContent = msg;
  statusMsg.className = 'status-msg' + (type ? ' ' + type : '');
}

function setProgress(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  barFill.style.width = pct + '%';
  progressPct.textContent = pct + '%';
  progressLabel.textContent = done > 0 ? `${done} of ${total} unfollowed` : 'Waiting to start';
}

function resetStats() {
  statTotal.textContent = '—';
  statDone.textContent = '0';
  statFriend.textContent = '0';
  barFill.style.width = '0%';
  progressPct.textContent = '0%';
  progressLabel.textContent = 'Starting...';
}

function setRunning(running) {
  state.running = running;
  mainBtn.disabled = running;
  mainBtn.className = 'main-btn' + (running ? ' running' : '');
  if (running) {
    btnText.innerHTML = '<div class="spinner"></div>Unfollowing...';
  } else {
    btnText.textContent = 'Start Auto Unfollow';
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.action) return;

  if (msg.action === 'phase') {
    setPhase(msg.phase);
    if (msg.message) setStatus(msg.message, 'loading');

  } else if (msg.action === 'totalFound') {
    state.total = msg.count;
    statTotal.textContent = msg.count;
    setStatus(`Found ${msg.count} accounts — starting...`, 'loading');
    setPhase('unfollowing');

  } else if (msg.action === 'progress') {
    const done = (msg.followingCount || 0) + (msg.friendCount || 0);
    statDone.textContent = msg.followingCount || 0;
    statFriend.textContent = msg.friendCount || 0;
    setProgress(done, state.total);
    setStatus(`Unfollowing... ${done}/${state.total}`, 'loading');

  } else if (msg.action === 'done') {
    const fol = msg.followingCount || 0;
    const fri = msg.friendCount || 0;
    const total = fol + fri;
    statDone.textContent = fol;
    statFriend.textContent = fri;
    setProgress(total, total);
    setStatus(`Done — ${total} unfollowed ✓`, 'done');
    setPhase('done');
    setRunning(false);
  }
});

mainBtn.addEventListener('click', () => {
  if (!state.following && !state.friend) {
    setStatus('Select at least one option above', 'error');
    return;
  }

  resetStats();
  setRunning(true);
  setPhase('scrolling');
  setStatus('Auto-scrolling to load accounts...', 'loading');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.url?.includes('tiktok.com')) {
      setStatus('Open TikTok first!', 'error');
      setPhase('error');
      setRunning(false);
      return;
    }

    chrome.tabs.sendMessage(
      tabs[0].id,
      {
        action: 'startUnfollow',
        unfollowFollowing: state.following,
        unfollowFriend: state.friend,
        delay: state.speed
      },
      (response) => {
        if (chrome.runtime.lastError) {
          setStatus('Error: ' + chrome.runtime.lastError.message, 'error');
          setPhase('error');
          setRunning(false);
          return;
        }
        if (response && !response.success && response.error) {
          setStatus('Error: ' + response.error, 'error');
          setPhase('error');
          setRunning(false);
        }
      }
    );
  });
});