# Project Plan: Yoinker 2.0 - Personal Cloud Media Suite

## 1. Vision

To transform the "Yoinker" desktop application into a powerful, personal cloud media suite. Users will be able to search for and download music/video from the web to their private server, and then access, stream, or download that media to any of their devices via a modern, cross-platform application.

---

## 2. Core Components

The system will be composed of three main, independent components:

1.  **Flutter Client (The App):** The user-facing application for Desktop (Windows, macOS, Linux) and Mobile (Android, iOS). This is the "remote control" for the whole system.
2.  **Web Backend (The Brains):** A Python-based web service running on your `sunnygong.com` server. It will handle user accounts, playlists, and orchestrate communication between the app and the Yoinker Service.
3.  **Yoinker Service (The Muscle):** A self-contained Python service, also running on your server. This is a refactored version of your original script, responsible for the heavy lifting of downloading and processing files.

---

## 3. System Architecture

This diagram illustrates how the components interact:

```
[ Your Devices (PC, Phone) ]
       |
       | Runs the Flutter Client App
       |
       v
+----------------------+      (HTTPS API Calls)      +-----------------------------+
|    Flutter Client    | <--------------------------> |   Web Backend (FastAPI)     |
| (Dart/Flutter)       |                              | (on sunnygong.com)          |
| - UI & Remote Control|                              | - User Accounts & Auth (JWT)|
+----------------------+                              | - Playlist Management       |
                                                      | - Database (PostgreSQL)     |
                                                      | - API Gateway               |
                                                      +-----------------------------+
                                                               |
                                                               | (Internal API Calls)
                                                               |
                                                      +-----------------------------+
                                                      |  Yoinker Service (FastAPI)  |
                                                      | (on sunnygong.com)          |
                                                      | - Wraps yt-dlp & ffmpeg     |
                                                      | - Downloads & Tags Files    |
                                                      | - Manages Media File Storage|
                                                      +-----------------------------+
```

---

## 4. Component Deep Dive

### 4.1. Flutter Client

*   **Purpose:** Provide a seamless, modern user experience for all platforms.
*   **Technology:** Dart, Flutter.
*   **Key Features:**
    *   **User Authentication:** Login and registration screens. Securely stores an auth token (JWT) to communicate with the Web Backend.
    *   **Search/Download UI:** An interface to search for media and submit download requests (for URLs or by metadata).
    *   **Task Manager:** A view to see the real-time progress of downloads happening on the server.
    *   **Remote Media Library:** A file browser to see, search, and manage the media files stored on the server.
    *   **Local Download:** Functionality to download files from the server library to the user's local device storage.
    *   **Playlist Management:** Create, view, add/remove items from playlists.
    *   **Audio Streaming:** An integrated music player to stream audio directly from the server without downloading it first.

### 4.2. Web Backend (API Gateway & Database)

*   **Purpose:** To be the central, secure gateway and data authority for the entire system.
*   **Technology:** Python, FastAPI, PostgreSQL (or other SQL DB), SQLAlchemy (ORM).
*   **Key Features:**
    *   **User Account System:** Secure user registration, login, and password management.
    *   **Authentication:** Issues and validates JSON Web Tokens (JWT) for every authenticated API request from the Flutter client. This is the "account system."
    *   **Database Management:** Defines and manages the SQL database for users, media file metadata, and playlists.
    *   **Public API:** Exposes all the functionality to the Flutter client (e.g., `/login`, `/search`, `/playlists`, `/library/download/{file_id}`).
    *   **Orchestration:** When a user requests a download, this backend validates the request, then makes an internal, server-to-server API call to the Yoinker Service to start the actual download.

### 4.3. Yoinker Service

*   **Purpose:** To handle the core, resource-intensive task of downloading and processing media. It is completely independent and has no concept of users or playlists.
*   **Technology:** Python, FastAPI, `yt-dlp`, `musicbrainzngs`, `mutagen`.
*   **Key Features:**
    *   **Standalone Service:** Runs as its own process on the server.
    *   **Internal API:** Exposes a simple, non-authenticated API accessible only from the Web Backend on the same server (e.g., `localhost:8001`).
        *   `POST /process-url`: Kicks off a download from a URL.
        *   `POST /process-search`: Kicks off a download from a metadata search.
        *   `GET /task/{task_id}`: Reports the status of a download.
    *   **File Management:** Manages the physical media files in a designated storage directory on the server (e.g., `/var/yoinker/media`).
    *   **Callbacks:** After a download is complete, it calls back to the Web Backend to tell it "Download complete, here is the file metadata," so the backend can add it to the database.

---

## 5. Data Models (Database Schema)

We'll need the following tables in our database:

*   **`users`**
    *   `id` (Primary Key)
    *   `username` (string, unique)
    *   `email` (string, unique)
    *   `hashed_password` (string)

*   **`media_files`**
    *   `id` (Primary Key)
    *   `owner_id` (Foreign Key to `users.id`)
    *   `title` (string)
    *   `artist` (string)
    *   `album` (string)
    *   `server_path` (string, path to the file on the server, e.g., `/var/yoinker/media/...`)
    *   `metadata_json` (json)
    *   `created_at` (datetime)

*   **`playlists`**
    *   `id` (Primary Key)
    *   `owner_id` (Foreign Key to `users.id`)
    *   `name` (string)
    *   `description` (text)

*   **`playlist_items`**
    *   `id` (Primary Key)
    *   `playlist_id` (Foreign Key to `playlists.id`)
    *   `media_file_id` (Foreign Key to `media_files.id`)
    *   `track_order` (integer)

---

## 6. Phased Development Plan

We will build this project in logical phases.

### Phase 1: Backend Foundation & User Accounts

*   **Goal:** Create a secure Web Backend with a working user account system.
*   **Steps:**
    1.  Initialize a new FastAPI project for the **Web Backend**.
    2.  Choose and set up a database (we can start with SQLite for simplicity and upgrade to PostgreSQL later).
    3.  Define the `users` data model.
    4.  Implement API endpoints for user registration and login (`/register`, `/login`) that return a JWT access token.
    5.  Implement basic JWT-based security for a test endpoint (e.g., `/users/me`).

### Phase 2: Yoinker Service Integration

*   **Goal:** Refactor the original Python script and make it communicate with the Web Backend.
*   **Steps:**
    1.  Create a second FastAPI project for the **Yoinker Service**.
    2.  Move all downloading, tagging, and `yt-dlp` logic from `yoinker.py` into this service.
    3.  Create the internal API endpoints (`/process-url`, etc.).
    4.  In the **Web Backend**, create a new authenticated endpoint (e.g., `POST /download/url`).
    5.  Implement the logic in this endpoint to call the internal Yoinker Service API.
    6.  Implement the callback mechanism for the Yoinker Service to report completed downloads to the Web Backend, which then saves the metadata to the `media_files` table.

### Phase 3: Basic Flutter Client

*   **Goal:** Create a minimal but functional Flutter app that can log in and start a download.
*   **Steps:**
    1.  Initialize a new Flutter project.
    2.  Build the UI for the Login and Register screens.
    3.  Implement the logic to call the Web Backend's `/login` and `/register` endpoints and securely store the JWT token.
    4.  Build the main "Download" UI.
    5.  Implement the logic to make an authenticated call to the Web Backend's `/download/url` endpoint.

### Phase 4: Media Library and Streaming

*   **Goal:** Allow users to see and interact with their media on the server.
*   **Steps:**
    1.  In the Web Backend, create API endpoints to:
        *   List all media files for the logged-in user (`GET /library`).
        *   Provide a secure download link/stream for a specific file (`GET /library/stream/{file_id}`).
    2.  In the Flutter app, build the "Library" UI to display the list of files.
    3.  Implement the client-side logic to download a selected file from the server to the device.
    4.  (Stretch) Integrate an audio player package in Flutter to stream from the `/library/stream/...` endpoint.

### Phase 5: Playlist System

*   **Goal:** Implement the full personal playlist system.
*   **Steps:**
    1.  In the Web Backend, create all API endpoints for CRUD (Create, Read, Update, Delete) operations on playlists and playlist items.
    2.  In the Flutter app, build the UI for creating playlists, viewing them, and adding/removing media files from the library.
