document.addEventListener("DOMContentLoaded", () => {
  const text = "Hi, I'm Sunny Gong";
  const target = document.querySelector(".typed-text");
  let i = 0;

  function typeWriter() {
    if (i < text.length) {
      target.textContent += text.charAt(i);
      i++;
      setTimeout(typeWriter, 75);
    }
  }

  typeWriter();

  const navbar = document.querySelector("header.navbar");
  window.addEventListener("scroll", () => {
    if (window.scrollY > 100) {
      navbar.classList.add("visible");
    } else {
      navbar.classList.remove("visible");
    }
  });

  const clickSound = document.getElementById("click-sound");
  const clickSound2 = document.getElementById("click-sound-2");
  const polaroidSound = document.getElementById("polaroid-sound");



  // Handle all header + hero links EXCEPT "Dreamer"
  const standardLinks = document.querySelectorAll(
    "header.navbar nav a, .hero-links a[href='projects.html'], .hero-links a[href='gallery.html']"
  );

  standardLinks.forEach(link => {
    const href = link.getAttribute("href");
    if (href.includes("instagram")) return; // Skip Dreamer (we handle it below)

    link.addEventListener("click", (e) => {
      e.preventDefault();
      clickSound.currentTime = 0;
      clickSound.play().then(() => {
        setTimeout(() => {
          window.location.href = href;
        }, 400);
      }).catch(() => {
        window.location.href = href;
      });
    });
  });

  // 🔊 Dreamer button uses click2.mp3
  const dreamerLink = document.querySelector(".hero-links a[href*='instagram']");
  if (dreamerLink) {
    dreamerLink.addEventListener("click", (e) => {
      e.preventDefault();
      clickSound2.currentTime = 0;
      clickSound2.play().then(() => {
        setTimeout(() => {
          window.open(dreamerLink.href, "_blank");
        }, 400);
      }).catch(() => {
        window.open(dreamerLink.href, "_blank");
      });
    });
  }

  const heroLogo = document.querySelector(".hero .logo");
  const video = document.getElementById("camera-video");
  const snapBtn = document.getElementById("snap-btn");
  const cameraContainer = document.getElementById("camera-container");
  const polaroidGallery = document.getElementById("polaroid-gallery");

  let stream = null;

  const floatingPolaroid = document.getElementById("floating-polaroid");

  if (heroLogo && polaroidSound) {
    heroLogo.style.cursor = "pointer";

    heroLogo.addEventListener("click", async () => {
      try {
        polaroidSound.currentTime = 0;
        polaroidSound.play();
    
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const track = stream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(track);
    
        const blob = await imageCapture.takePhoto();
        const imageUrl = URL.createObjectURL(blob);
    
        // Reset animation and show the big drop
        floatingPolaroid.innerHTML = `
          <button class="close-polaroid">✖</button>
          <div class="polaroid-inner">
            <img src="${imageUrl}" alt="Snapshot" class="polaroid-photo" />
            <img src="images/polaroid-frame.png" alt="Polaroid Frame" class="polaroid-frame-img" />
            <button class="share-polaroid">📩 Share with Sunny</button>
          </div>
        `;

                // Close button
        const closeBtn = floatingPolaroid.querySelector('.close-polaroid');
        closeBtn.addEventListener('click', () => {
          floatingPolaroid.style.display = "none";
        });

        // Share button
        const shareBtn = floatingPolaroid.querySelector('.share-polaroid');
        shareBtn.addEventListener('click', () => {
          alert("📩 Can Not Send Photo");

          // TODO: Upload logic or email
          // Right now: simulate by opening your mail client
          const mailto = `mailto:s43gong@uwaterloo.ca?subject=Photo from Portfolio&body=Hi Sunny,%0D%0AHere's my photo from your site! 😄`;
          window.location.href = mailto;
        });

      

        floatingPolaroid.style.display = "block";
        floatingPolaroid.style.animation = "none"; // reset
        void floatingPolaroid.offsetWidth; // trigger reflow
        floatingPolaroid.style.animation = "polaroid-drop 1.6s ease-in forwards";
    
        stream.getTracks().forEach(t => t.stop());
      } catch (err) {
        console.error("Camera/photo error:", err);
        alert("Could not access your camera or take a photo.");
      }
    });
    
  }


    // Take snapshot and show as polaroid
    snapBtn.addEventListener("click", () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imgData = canvas.toDataURL("image/png");

      const polaroid = document.createElement("div");
      polaroid.classList.add("polaroid-frame");
      polaroid.innerHTML = `<img src="${imgData}" alt="Polaroid Photo" />`;

      polaroidGallery.appendChild(polaroid);

      // Optional: stop camera after snap
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      cameraContainer.style.display = "none";
    });

});

