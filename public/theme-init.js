try { var t = JSON.parse(localStorage.getItem('cb:theme')); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}
