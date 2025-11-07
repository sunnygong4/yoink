✦ Yes, you will need to copy the entire yoink folder to your MacBook. Here is a more detailed      
  guide to go from a clean Mac to a finished disk image.

  On your MacBook:

  1. Install Homebrew

  Homebrew is a package manager that makes it easy to install software. Open the Terminal app
  and paste this command:

   1 /bin/bash -c "$(curl -fsSL 
     https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  Follow the on-screen instructions. This will also install the Xcode Command Line Tools, which
  are required.

  2. Install Python and FFmpeg

  Once Homebrew is installed, use it to install Python and FFmpeg. FFmpeg is a dependency for
  your application.

   1 brew install python ffmpeg

  3. Copy Your Project

  Copy the entire yoink folder from your Windows machine to your MacBook. You can do this with
   a USB drive, a shared network folder, or a cloud service like Google Drive or Dropbox.

  4. Build the Application

  Now, open a new Terminal window on your Mac and follow these steps:

  a.  Navigate to your project folder. For example, if you copied it to your Desktop, you would
  type:
   1     cd ~/Desktop/yoink

  b.  Install `py2app`:
   1     pip3 install -U py2app

  c.  Run the build process:
   1     python3 setup.py py2app

  After the process completes, you will find a dist folder inside your yoink directory. Your
  Yoinker.dmg disk image will be inside that dist folder.