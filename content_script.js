// content_script.js
(() => {
  console.log('Shift Hello content script loaded');

  const DIALOG_ID = 'shift-hello-dialog-unique-01';
  let mouseX = 0, mouseY = 0;
  let isVisible = false;

  // Track mouse position
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }, {capture: true, passive: true});

  // Show dialog when Shift is pressed
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift' && !isVisible) {
      showDialog(mouseX, mouseY);
    }
    if (e.key === 'Escape' && isVisible) {
      hideDialog();
    }
  }, true);

  // Hide dialog if clicking outside of it
  document.addEventListener('mousedown', (e) => {
    if (!isVisible) return;
    const dialog = document.getElementById(DIALOG_ID);
    if (dialog && !dialog.contains(e.target)) {
      hideDialog();
    }
  }, true);

  function showDialog(x, y) {
    hideDialog(); // remove any existing one

    const d = document.createElement('div');
    d.id = DIALOG_ID;
    d.textContent = 'Hello, world!'; // change text here
    Object.assign(d.style, {
      position: 'fixed',
      left: `${x + 12}px`,
      top: `${y + 12}px`,
      zIndex: 2147483647,
      pointerEvents: 'auto',
      padding: '8px 12px',
      background: 'white',
      color: '#111',
      border: '1px solid rgba(0,0,0,0.15)',
      borderRadius: '8px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
      fontSize: '14px',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial',
      userSelect: 'none'
    });

    // Optional close button inside
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.marginLeft = '10px';
    closeBtn.onclick = () => hideDialog();
    d.appendChild(closeBtn);

    document.documentElement.appendChild(d);
    isVisible = true;
  }

  function hideDialog() {
    const existing = document.getElementById(DIALOG_ID);
    if (existing) existing.remove();
    isVisible = false;
  }
})();
