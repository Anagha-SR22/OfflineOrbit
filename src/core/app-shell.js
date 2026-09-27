import { registerRoute, setNotFound, startRouter, navigate } from './router.js';
import { renderSyllabus, setLanguage, getLanguage } from './syllabus-view.js';
import { initConnectionStatus } from './connection-status.js';
import { initLesson, applyLanguage } from '../lessons/lesson-runtime.js';
import { renderDashboard, renderLeaderboard } from '../dashboard/dashboard.js';

const LESSONS = {
  l1: { en: 'Whole Numbers', hi: 'पूर्ण संख्याएँ', file: '/lessons/l1.html' },
  l2: { en: 'Fractions', hi: 'भिन्न', file: '/lessons/l2.html' },
  l3: { en: 'Basic Geometry', hi: 'आधारभूत ज्यामिति', file: '/lessons/l3.html' },
  s1: { en: 'Plants Around Us', hi: 'हमारे आसपास के पौधे', file: '/lessons/s1.html' },
  s2: { en: 'States of Matter', hi: 'पदार्थ की अवस्थाएँ', file: '/lessons/s2.html' }
};

const USER_KEY = 'offlineOrbitUser';

export function makeStudentId(name, classId) {
  return `${String(name).trim().toLowerCase()}::${String(classId).trim().toLowerCase()}`;
}

export function getStudent() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch { return null; }
}

// The login form only asks for a name + class ID — there's no separate
// "role" field. A student who logs in with the name "teacher" (any case,
// any class ID) gets routed to the teacher view instead of the student view.
export function isTeacher(student) {
  return !!student && String(student.name).trim().toLowerCase() === 'teacher';
}

export function initAppShell(rootEl) {
  const student = getStudent();
  if (!student) {
    renderLogin(rootEl);
    return;
  }
  renderShell(rootEl, student);
}

function renderLogin(rootEl) {
  rootEl.innerHTML = `
    <main class="login-page">
      <section class="login-card">
        <div class="login-orbit"><img src="/branding/logo-192.png" alt="OfflineOrbit"></div>
        <span class="eyebrow">WELCOME TO OFFLINEORBIT</span>
        <h1>Learn anywhere.<br><span>Even offline.</span></h1>
        <p class="login-subtitle">Enter your name and class ID to continue. Your learning progress is saved separately for this login.</p>
        <form id="login-form" class="login-form">
          <label>Student name<input id="student-name" type="text" autocomplete="name" placeholder="e.g. Ananya" required></label>
          <label>Class ID<input id="class-id" type="text" placeholder="e.g. 4A" required></label>
          <p class="login-note">For this prototype, any class ID is accepted.</p>
          <p class="login-note">Teacher? Log in with the name <strong>teacher</strong> to see the class dashboard.</p>
          <button class="primary-btn" type="submit">Start Learning <span>→</span></button>
        </form>
      </section>
      <div class="login-decoration decoration-one">+</div>
      <div class="login-decoration decoration-two">×</div>
      <div class="login-decoration decoration-three">✦</div>
    </main>
  `;

  document.getElementById('login-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = document.getElementById('student-name').value.trim();
    const classId = document.getElementById('class-id').value.trim();
    if (!name || !classId) return;

    const student = { name, classId, studentId: makeStudentId(name, classId) };
    localStorage.setItem(USER_KEY, JSON.stringify(student));
    window.location.hash = '#/syllabus';
    renderShell(rootEl, student);
  });
}

function renderShell(rootEl, student) {
  const teacher = isTeacher(student);

  const navLinks = teacher
    ? `<a href="#/syllabus"><span>📚</span> Lessons</a>
       <a href="#/dashboard"><span>🧑‍🏫</span> Teacher Dashboard</a>`
    : `<a href="#/syllabus"><span>📚</span> Lessons</a>
       <a href="#/dashboard"><span>📈</span> My Progress</a>
       <a href="#/leaderboard"><span>🏆</span> Leaderboard</a>`;

  const chipLabel = teacher ? 'Teacher' : student.name;
  const chipAvatar = teacher ? '🧑‍🏫' : student.name.charAt(0).toUpperCase();

  rootEl.innerHTML = `
    <header class="app-header">
      <a class="brand" href="#/syllabus" aria-label="OfflineOrbit home">
        <span class="brand-orbit"><img src="/branding/logo-64.png" alt="OfflineOrbit"></span>
        <span><strong>OfflineOrbit</strong><small>Learn anywhere. Even offline.</small></span>
      </a>
      <nav class="app-nav">
        ${navLinks}
      </nav>
      <div class="app-controls">
        <div class="student-chip"><span class="avatar">${escapeHtml(chipAvatar)}</span><span>${escapeHtml(chipLabel)}</span></div>
        <div class="lang-toggle" id="lang-toggle"><button data-lang="en" type="button">EN</button><button data-lang="hi" type="button">हिं</button></div>
        <button id="accessibility-toggle" class="accessibility-toggle" type="button" aria-expanded="false" aria-controls="accessibility-panel" title="Accessibility settings">♿</button>
        <div id="conn-status"></div>
      </div>
    </header>
    <main id="view-container" class="view-container"></main>
  `;

  initConnectionStatus(document.getElementById('conn-status'));
  initAccessibilityControls();
  const langToggle = document.getElementById('lang-toggle');
  const viewContainer = document.getElementById('view-container');
  let currentRouteName = null;

  function updateLangButtons() {
    langToggle.querySelectorAll('button').forEach((button) =>
      button.classList.toggle('active', button.dataset.lang === getLanguage())
    );
  }

  langToggle.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-lang]');
    if (!button) return;
    setLanguage(button.dataset.lang);
    updateLangButtons();
    if (currentRouteName === 'syllabus') renderSyllabus(viewContainer, student);
    if (currentRouteName === 'lesson') applyLanguage(getLanguage());
    if (currentRouteName === 'dashboard') renderDashboard(viewContainer, student);
    if (currentRouteName === 'leaderboard') renderLeaderboard(viewContainer, student);
  });

  registerRoute('#/syllabus', () => {
    currentRouteName = 'syllabus';
    renderSyllabus(viewContainer, student);
  });

  registerRoute('#/lesson/:id', async ({ id }) => {
    currentRouteName = 'lesson';
    await renderLesson(viewContainer, id, student);
  });

  registerRoute('#/dashboard', () => {
    currentRouteName = 'dashboard';
    renderDashboard(viewContainer, student);
  });

  // Leaderboard is a student-facing feature. A teacher landing here (e.g. via
  // an old link) is sent to the class dashboard instead.
  registerRoute('#/leaderboard', () => {
    if (teacher) { navigate('#/dashboard'); return; }
    currentRouteName = 'leaderboard';
    renderLeaderboard(viewContainer, student);
  });

  setNotFound(() => navigate('#/syllabus'));
  updateLangButtons();
  startRouter();
}

async function renderLesson(container, lessonId, student) {
  const lesson = LESSONS[lessonId];
  if (!lesson) {
    container.innerHTML = '<div class="error-box"><p class="error">Lesson not found.</p><a class="primary-btn inline-btn" href="#/syllabus">Back to lessons</a></div>';
    return;
  }

  container.innerHTML = '<div class="lesson-loading"><div class="spinner"></div><p>Preparing your lesson…</p></div>';

  try {
    const url = new URL(lesson.file, window.location.origin).href;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Lesson file could not be loaded (${response.status}).`);
    const html = await response.text();
    if (!html.trim()) throw new Error('This lesson is empty.');

    container.innerHTML = `
      <div class="lesson-page">
        <div class="lesson-topbar">
          <a class="back-link" href="#/syllabus">← Back to lessons</a>
          <div class="lesson-topbar-actions">
            <span class="lesson-badge">📖 ${escapeHtml(lesson[getLanguage()] || lesson.en)}</span>
          </div>
        </div>
        ${html}
      </div>
    `;
    await initLesson(container, getLanguage(), student);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    console.error(error);
    container.innerHTML = `
      <div class="error-box">
        <div class="error-icon">!</div>
        <h2>We couldn't open this lesson</h2>
        <p class="error-detail">${escapeHtml(error.message)}</p>
        <div class="error-actions">
          <a class="primary-btn inline-btn" href="#/lesson/${encodeURIComponent(lessonId)}">Try again</a>
          <a class="secondary-btn inline-btn" href="#/syllabus">Back to lessons</a>
        </div>
      </div>
    `;
  }
}


const ACCESSIBILITY_KEY = 'offlineOrbitAccessibility';

function readAccessibilitySettings() {
  const defaults = { largeTargets: true, contrast: false, dyslexia: false };
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(ACCESSIBILITY_KEY) || '{}')) };
  } catch {
    return defaults;
  }
}

function writeAccessibilitySettings(settings) {
  localStorage.setItem(ACCESSIBILITY_KEY, JSON.stringify(settings));
}

function applyAccessibilitySettings(settings) {
  document.body.classList.toggle('a11y-large-targets', !!settings.largeTargets);
  document.body.classList.toggle('a11y-contrast', !!settings.contrast);
  document.body.classList.toggle('a11y-dyslexia', !!settings.dyslexia);
}

function initAccessibilityControls() {
  const settings = readAccessibilitySettings();
  applyAccessibilitySettings(settings);

  const toggle = document.getElementById('accessibility-toggle');
  if (!toggle || document.getElementById('accessibility-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'accessibility-panel';
  panel.className = 'accessibility-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Accessibility settings');
  panel.innerHTML = `
    <div class="accessibility-panel-head">
      <strong>Accessibility</strong>
      <button type="button" class="accessibility-close" aria-label="Close accessibility settings">×</button>
    </div>
    <label class="a11y-setting"><input id="a11y-large-targets" type="checkbox"><span><strong>Larger touch targets</strong><small>Helpful on older tablets and shared devices.</small></span></label>
    <label class="a11y-setting"><input id="a11y-contrast" type="checkbox"><span><strong>High-contrast theme</strong><small>Stronger text and control contrast for bright rooms.</small></span></label>
    <label class="a11y-setting"><input id="a11y-dyslexia" type="checkbox"><span><strong>Dyslexia-friendly reading</strong><small>Uses a more readable font with extra spacing.</small></span></label>
  `;
  document.body.appendChild(panel);

  const sync = () => {
    document.getElementById('a11y-large-targets').checked = !!settings.largeTargets;
    document.getElementById('a11y-contrast').checked = !!settings.contrast;
    document.getElementById('a11y-dyslexia').checked = !!settings.dyslexia;
    applyAccessibilitySettings(settings);
  };
  sync();

  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) panel.querySelector('input')?.focus();
  });
  panel.querySelector('.accessibility-close').addEventListener('click', () => {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  });

  const bind = (id, key) => {
    panel.querySelector(`#${id}`).addEventListener('change', (event) => {
      settings[key] = event.target.checked;
      writeAccessibilitySettings(settings);
      applyAccessibilitySettings(settings);
    });
  };
  bind('a11y-large-targets', 'largeTargets');
  bind('a11y-contrast', 'contrast');
  bind('a11y-dyslexia', 'dyslexia');
}

function escapeHtml(value) {
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
