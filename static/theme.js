(() => {
  const storageKey = "branch.theme";
  const toggle = document.getElementById("theme-toggle");
  if (!toggle) return;

  const applyTheme = (value) => {
    document.body.dataset.theme = value;
    localStorage.setItem(storageKey, value);
    toggle.textContent = value === "light" ? "Dark" : "Light";
  };

  const saved = localStorage.getItem(storageKey) || "dark";
  applyTheme(saved);

  toggle.addEventListener("click", () => {
    const next = document.body.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
  });
})();
