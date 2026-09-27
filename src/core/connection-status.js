// Renders a small "Online" / "Offline" badge into the given container
// and keeps it in sync with the browser's connectivity state.

export function initConnectionStatus(containerEl) {
  const badge = document.createElement('span');
  badge.className = 'status-badge';
  containerEl.appendChild(badge);

  function update() {
    const online = navigator.onLine;
    badge.textContent = online ? 'Online' : 'Offline';
    badge.classList.toggle('status-online', online);
    badge.classList.toggle('status-offline', !online);
  }

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();

  return { update };
}
