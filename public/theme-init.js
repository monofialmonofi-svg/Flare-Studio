// يُحمَّل متزامنًا في <head> لتجنّب وميض الثيم (CSP لا يسمح بالسكربت المضمّن).
(function () {
  try {
    var pref = localStorage.getItem('lamma-theme') || 'auto';
    var dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) { document.documentElement.dataset.theme = 'light'; }
})();
