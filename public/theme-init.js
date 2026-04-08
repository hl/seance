(function () {
  var stored = localStorage.getItem("seance-theme");
  var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  var isDark = stored === "dark" || ((stored === "system" || !stored) && prefersDark);
  if (isDark) document.documentElement.classList.add("dark");
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
})();
