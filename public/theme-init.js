const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
let savedTheme = null;

try {
  savedTheme = window.localStorage.getItem("aster-theme");
} catch (error) {
  console.error("Unable to read the saved theme preference.", error);
}

document.documentElement.dataset.theme =
  savedTheme === "light" || savedTheme === "dark"
    ? savedTheme
    : systemPrefersDark ? "dark" : "light";
