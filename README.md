# MarkCloud

A real-time collaborative Markdown editor that enables multiple users to edit documents simultaneously with live synchronization, online presence tracking, and automatic cloud persistence.

## Overview

MarkCloud is a cloud-based Markdown editor built to demonstrate real-time collaboration using Supabase Realtime and a lightweight Node.js backend. The application separates live editing from persistent storage by broadcasting keystrokes over realtime channels while periodically saving document changes to PostgreSQL.

## Features

* Real-time collaborative Markdown editing
* Live user presence tracking
* Automatic document persistence
* Multi-file workspace support
* Split-screen editor with Markdown preview
* Keyboard shortcuts for common formatting operations
* Responsive user interface
* Cloud-backed storage with PostgreSQL

## Technology Stack

### Frontend

* HTML5
* Vanilla JavaScript
* Tailwind CSS
* Marked.js

### Backend

* Node.js
* Express.js

### Database & Realtime

* Supabase
* PostgreSQL
* Supabase Realtime
* Supabase Presence

## Architecture

```text
Browser
    │
    ├── Realtime Broadcast
    │
Supabase Realtime
    │
    ├── Instant synchronization
    │
Express API
    │
    ├── Auto-save
    │
Supabase PostgreSQL
```

The application uses two independent communication paths:

* **Realtime Broadcast** for low-latency collaborative editing.
* **REST API** for debounced persistence to PostgreSQL.

This architecture minimizes database writes while maintaining an instant collaborative editing experience.

## Project Structure

```text
markdown-cloud-editor/
│
├── public/
│   ├── index.html
│   └── app.js
├── server.js
├── supabase-schema.sql
├── package.json
├── package-lock.json
├── README.md
└── .env.example
```

## Getting Started

### Clone the repository

```bash
git clone https://github.com/vanshbeni/markdown-cloud-editor.git
cd markdown-cloud-editor
```

### Install dependencies

```bash
npm install
```

### Configure environment variables

Create a `.env` file.

```env
SUPABASE_URL=YOUR_SUPABASE_URL
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
PORT=3000
```

### Start the application

Development

```bash
npm run dev
```

Production

```bash
npm start
```

Open:

```
http://localhost:3000
```

## Database Setup

1. Create a Supabase project.
2. Execute `supabase-schema.sql` in the SQL Editor.
3. Enable Realtime for the `files` table.
4. Configure the required environment variables.

## Keyboard Shortcuts

| Shortcut       | Action        |
| -------------- | ------------- |
| Ctrl / Cmd + S | Save document |
| Ctrl / Cmd + B | Bold          |
| Ctrl / Cmd + I | Italic        |

## Future Enhancements

* User authentication
* Document version history
* Role-based permissions
* Syntax highlighting
* Export to PDF and HTML
* Offline editing support
* AI-assisted writing features

## License

This project is intended for educational and portfolio purposes.

## Author

**Vansh Beni**
