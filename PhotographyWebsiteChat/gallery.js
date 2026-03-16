document.addEventListener("DOMContentLoaded", () => {
  const clickSound = document.getElementById("click-sound");
  const groupButtons = document.querySelectorAll(".group-btn");
  const filterPanel = document.querySelector(".filter-panel");

  // Navigation click sound
  document.querySelectorAll("nav a").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      clickSound.currentTime = 0;
      clickSound.play().then(() => {
        setTimeout(() => window.location.href = link.href, 300);
      }).catch(() => window.location.href = link.href);
    });
  });

  // Apply Filters (placeholder)
  document.getElementById("apply-filters").addEventListener("click", () => {
    alert("Filter functionality coming soon!");
  });

  // Grouping Buttons Logic (only defined ONCE)
  groupButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      groupButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const group = btn.dataset.group;

      // Show filter only for gear or time
      if (group === "gear" || group === "time") {
        filterPanel.style.display = "flex";
      } else {
        filterPanel.style.display = "none";
      }

      loadGalleryByGroup(group); // You can define this dynamically
    });
  });
});
