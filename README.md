# Task Manager Clone (Process Management)

A medium-level **process management** project that shows how the OS monitors, lists, and terminates running processes.

## API Design
- `GET /api/processes` → list running processes with `pid`, `name`, `user`, `state`, `cpu_percent`, `mem_percent`, `vmrss_kb`, `vmsize_kb`
- `POST /api/kill` → terminate a process with JSON body `{ "pid": 1234 }`

## Run Locally

### 1) Backend (C API server)
```bash
cd "backend"
make
./taskd
```
The API starts on `http://localhost:8080`.

### 2) Frontend (React UI)
```bash
cd "frontend"
npm install
npm run dev
```
The UI runs on `http://localhost:5173`.

## Notes
- Linux uses `/proc` for process details.
- If `/proc` is unavailable (e.g., macOS), the backend falls back to `ps`.
- Use **User only** toggle for a clean demo view.
