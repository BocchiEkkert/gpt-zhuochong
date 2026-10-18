'use strict';
try { document.documentElement.dataset.theme = localStorage.getItem('mori-theme') === 'dark' ? 'dark' : 'light'; } catch { /* Default to light until settings load. */ }
