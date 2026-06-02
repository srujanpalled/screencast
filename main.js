/* ═══════════════════════════════════════════════════════════
   ScreenCast — Core Application Logic
   P2P Screen Sharing via WebRTC + PeerJS
   ═══════════════════════════════════════════════════════════ */

import './style.css';
import Peer from 'peerjs';

// ── Configuration ─────────────────────────────────────────────
const CONFIG = {
  // PeerJS uses its free cloud server by default
  // ICE servers for NAT traversal (all free)
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
  // Room ID length (characters)
  roomIdLength: 8,
  // Reconnect timeout (ms)
  reconnectTimeout: 5000,
};

// ── State ─────────────────────────────────────────────────────
let peer = null;
let currentCall = null;
let localStream = null;
let isViewer = false;

// ── DOM Elements ──────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Modes
const viewerMode = $('#viewerMode');
const sharerMode = $('#sharerMode');
const errorMode = $('#errorMode');

// Viewer states
const viewerIdle = $('#viewerIdle');
const viewerWaiting = $('#viewerWaiting');
const viewerConnected = $('#viewerConnected');
const viewerDisconnected = $('#viewerDisconnected');

// Sharer states
const sharerReady = $('#sharerReady');
const sharerConnecting = $('#sharerConnecting');
const sharerSharing = $('#sharerSharing');
const sharerEnded = $('#sharerEnded');

// Buttons
const btnGenerate = $('#btnGenerate');
const btnCopy = $('#btnCopy');
const btnNewLink = $('#btnNewLink');
const btnFullscreen = $('#btnFullscreen');
const btnDisconnect = $('#btnDisconnect');
const btnShare = $('#btnShare');
const btnStopShare = $('#btnStopShare');
const btnRestart = $('#btnRestart');
const btnRetry = $('#btnRetry');

// Media
const remoteVideo = $('#remoteVideo');
const localPreview = $('#localPreview');

// Display
const linkText = $('#linkText');
const copyLabel = $('#copyLabel');
const videoOverlay = $('#videoOverlay');

// ── Utility Functions ─────────────────────────────────────────

/** Generate a cryptographically random room ID */
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const arr = new Uint8Array(CONFIG.roomIdLength);
  crypto.getRandomValues(arr);
  return Array.from(arr, (byte) => chars[byte % chars.length]).join('');
}

/** Get the base URL for shareable links */
function getBaseUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

/** Show a toast notification */
function showToast(message, type = 'info') {
  const container = $('#toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/** Switch visible view-state within a mode */
function showState(mode, stateEl) {
  const states = mode.querySelectorAll('.view-state');
  states.forEach((s) => s.classList.add('hidden'));
  stateEl.classList.remove('hidden');
}

/** Show a specific mode (viewer/sharer/error) */
function showMode(modeEl) {
  [viewerMode, sharerMode, errorMode].forEach((m) => m.classList.add('hidden'));
  modeEl.classList.remove('hidden');
}

/** Show error screen */
function showError(title, message) {
  $('#errorTitle').textContent = title;
  $('#errorMessage').textContent = message;
  showMode(errorMode);
}

// ── Background Particles ──────────────────────────────────────
function initParticles() {
  const container = $('#bgParticles');
  const count = 30;
  
  for (let i = 0; i < count; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.animationDuration = `${8 + Math.random() * 12}s`;
    particle.style.animationDelay = `${Math.random() * 10}s`;
    particle.style.width = `${1 + Math.random() * 2}px`;
    particle.style.height = particle.style.width;
    particle.style.background = Math.random() > 0.5 
      ? 'rgba(167, 139, 250, 0.3)' 
      : 'rgba(99, 102, 241, 0.2)';
    container.appendChild(particle);
  }
}

// ── PeerJS Initialization ─────────────────────────────────────

/** Create a new PeerJS instance */
function createPeer(peerId = undefined) {
  return new Promise((resolve, reject) => {
    const options = {
      config: {
        iceServers: CONFIG.iceServers,
      },
    };
    
    const p = peerId ? new Peer(peerId, options) : new Peer(options);
    
    p.on('open', (id) => {
      console.log('[ScreenCast] Peer connected with ID:', id);
      resolve(p);
    });
    
    p.on('error', (err) => {
      console.error('[ScreenCast] Peer error:', err);
      if (err.type === 'peer-unavailable') {
        showError('Session Not Found', 'This link may have expired or the session has ended. Ask for a new link.');
      } else if (err.type === 'unavailable-id') {
        // ID collision — regenerate
        reject(new Error('id-collision'));
      } else {
        reject(err);
      }
    });
    
    p.on('disconnected', () => {
      console.log('[ScreenCast] Peer disconnected from signaling');
    });
  });
}

/** Destroy existing peer connection */
function destroyPeer() {
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (peer) {
    peer.destroy();
    peer = null;
  }
}

// ── VIEWER LOGIC ──────────────────────────────────────────────

async function initViewer() {
  isViewer = true;
  showMode(viewerMode);
  showState(viewerMode, viewerIdle);
}

/** Generate a new room link and start listening */
async function generateLink() {
  btnGenerate.disabled = true;
  btnGenerate.textContent = 'Generating...';
  
  try {
    // Generate a random room ID
    const roomId = generateRoomId();
    
    // Create peer with the room ID as its ID
    // This way the sharer can connect using just the room ID
    try {
      peer = await createPeer(`sc-${roomId}`);
    } catch (err) {
      if (err.message === 'id-collision') {
        // Extremely rare — just try again with a new ID
        const newRoomId = generateRoomId();
        peer = await createPeer(`sc-${newRoomId}`);
      } else {
        throw err;
      }
    }
    
    // Build the shareable link
    const link = `${getBaseUrl()}?room=${peer.id.replace('sc-', '')}`;
    linkText.textContent = link;
    
    // Switch to waiting state
    showState(viewerMode, viewerWaiting);
    
    // Listen for incoming calls from the sharer
    peer.on('call', (call) => {
      console.log('[ScreenCast] Incoming call from sharer');
      
      // Answer with no stream (we're only receiving)
      call.answer();
      currentCall = call;
      
      call.on('stream', (remoteStream) => {
        console.log('[ScreenCast] Receiving remote screen stream');
        remoteVideo.srcObject = remoteStream;
        showState(viewerMode, viewerConnected);
        showToast('Screen connected!', 'success');
      });
      
      call.on('close', () => {
        console.log('[ScreenCast] Call closed');
        handleViewerDisconnect();
      });
      
      call.on('error', (err) => {
        console.error('[ScreenCast] Call error:', err);
        handleViewerDisconnect();
      });
    });
    
    // Handle peer connection close
    peer.on('close', () => {
      handleViewerDisconnect();
    });
    
  } catch (err) {
    console.error('[ScreenCast] Failed to generate link:', err);
    showError('Connection Failed', 'Could not connect to signaling service. Please check your internet and try again.');
  } finally {
    btnGenerate.disabled = false;
    btnGenerate.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
      Generate Link
    `;
  }
}

/** Handle viewer disconnect */
function handleViewerDisconnect() {
  remoteVideo.srcObject = null;
  showState(viewerMode, viewerDisconnected);
}

/** Copy link to clipboard */
async function copyLink() {
  const link = linkText.textContent;
  try {
    await navigator.clipboard.writeText(link);
    copyLabel.textContent = 'Copied!';
    showToast('Link copied to clipboard!', 'success');
    setTimeout(() => {
      copyLabel.textContent = 'Copy';
    }, 2000);
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = link;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    copyLabel.textContent = 'Copied!';
    showToast('Link copied!', 'success');
    setTimeout(() => {
      copyLabel.textContent = 'Copy';
    }, 2000);
  }
}

/** Generate a new link (discard current) */
async function regenerateLink() {
  destroyPeer();
  await generateLink();
}

/** Toggle fullscreen on the viewer screen */
function toggleFullscreen() {
  const screen = $('.viewer-screen');
  if (!document.fullscreenElement) {
    screen.requestFullscreen?.() || screen.webkitRequestFullscreen?.();
  } else {
    document.exitFullscreen?.() || document.webkitExitFullscreen?.();
  }
}

/** Disconnect from current session */
function disconnect() {
  destroyPeer();
  handleViewerDisconnect();
}

/** Restart viewer (go back to idle) */
function restart() {
  destroyPeer();
  showState(viewerMode, viewerIdle);
}

// ── SHARER LOGIC ──────────────────────────────────────────────

async function initSharer(roomId) {
  isViewer = false;
  showMode(sharerMode);
  showState(sharerMode, sharerReady);
  
  // Store room ID for later use
  sharerMode.dataset.roomId = roomId;
}

/** Start sharing screen */
async function startSharing() {
  const roomId = sharerMode.dataset.roomId;
  
  try {
    // Show connecting state
    showState(sharerMode, sharerConnecting);
    
    // Capture screen first — so user sees the picker immediately
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor',
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (err) {
      console.log('[ScreenCast] User cancelled screen selection');
      showState(sharerMode, sharerReady);
      return;
    }
    
    // Show preview
    localPreview.srcObject = localStream;
    
    // Handle if user stops sharing via browser UI (the "Stop sharing" button)
    localStream.getVideoTracks()[0].addEventListener('ended', () => {
      console.log('[ScreenCast] User stopped sharing via browser UI');
      stopSharing();
    });
    
    // Connect to PeerJS
    peer = await createPeer();
    
    // Call the viewer's peer (using room ID)
    const call = peer.call(`sc-${roomId}`, localStream);
    currentCall = call;
    
    if (!call) {
      throw new Error('Failed to initiate call');
    }
    
    call.on('stream', () => {
      // Viewer answered — sharing is active
    });
    
    // Once call is open, show sharing state
    call.on('close', () => {
      console.log('[ScreenCast] Call closed by viewer');
      stopSharing();
    });
    
    call.on('error', (err) => {
      console.error('[ScreenCast] Call error:', err);
      stopSharing();
    });
    
    // Show sharing state
    showState(sharerMode, sharerSharing);
    
  } catch (err) {
    console.error('[ScreenCast] Failed to start sharing:', err);
    if (err.type === 'peer-unavailable') {
      showError('Session Expired', 'This link has expired or the viewer has disconnected. Ask for a new link.');
    } else {
      showError('Connection Failed', 'Could not establish connection. Please check your internet and try again.');
    }
  }
}

/** Stop sharing screen */
function stopSharing() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (localPreview) {
    localPreview.srcObject = null;
  }
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (peer) {
    peer.destroy();
    peer = null;
  }
  showState(sharerMode, sharerEnded);
}

// ── EVENT LISTENERS ───────────────────────────────────────────

// Viewer buttons
btnGenerate.addEventListener('click', generateLink);
btnCopy.addEventListener('click', copyLink);
btnNewLink.addEventListener('click', regenerateLink);
btnFullscreen.addEventListener('click', toggleFullscreen);
btnDisconnect.addEventListener('click', disconnect);
btnRestart.addEventListener('click', restart);

// Sharer buttons
btnShare.addEventListener('click', startSharing);
btnStopShare.addEventListener('click', stopSharing);

// Error retry
btnRetry.addEventListener('click', () => {
  window.location.reload();
});

// ── ROUTING ───────────────────────────────────────────────────

function init() {
  // Initialize background particles
  initParticles();
  
  // Check URL for room parameter
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room');
  
  if (roomId) {
    // Sharer mode — someone shared a link with us
    console.log('[ScreenCast] Sharer mode — room:', roomId);
    initSharer(roomId);
  } else {
    // Viewer mode — generate a link
    console.log('[ScreenCast] Viewer mode');
    initViewer();
  }
}

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // SW registration failed — app still works fine without it
  });
}

// Start the app
init();
