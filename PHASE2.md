Operating Systems Mini Project – Phase 2
Project Title:

Operating System Based Task Manager Clone

Student Name(s):

Sugat & Siddhartha
Roll No(s): 230109, 230104
Branch / Section: B-Tech CS & AI
Guide Name: Anuj Kumar Jha

1. Phase-2 Focus

In Phase 2, we focused on improving data quality and UI behavior so that displayed values are closer to actual system monitor values. We upgraded both backend metric collection and frontend rendering logic.

2. Objectives Achieved In Phase 2

Improve process metric accuracy for CPU, memory, and thread usage.

Add proper tab-based monitoring views (CPU, Memory, Energy, Disk, Network).

Add pagination and scrolling for large process tables.

Add better system summary panels for mentor-level explanation and demo.

3. Backend Enhancements (C Server)

Added real thread count in process response (`threads`).

Added per-process CPU runtime (`cpu_time_sec`).

Extended `/api/processes` response with system-level fields:

`cpu_user_percent`

`cpu_system_percent`

`cpu_idle_percent`

`mem_total_kb`

`mem_used_kb`

`app_memory_kb`

`wired_memory_kb`

`compressed_memory_kb`

`cached_files_kb`

`swap_used_kb`

Implemented platform-aware metric collection:

Linux path via `/proc`.

macOS path via `ps`, `top`, `vm_stat`, and `sysctl` parsing.

Retained existing `POST /api/kill` process termination support.

4. Frontend Enhancements (React)

Implemented full tab switching with different column models for:

CPU

Memory

Energy

Disk

Network

Added pagination controls:

First / Prev / Next / Last

Rows-per-page selector

Current visible range text

Added table scrolling and full-screen process view handling.

Connected charts and summary cards to backend-provided system stats.

Reworked derived (non-native) values to remain bounded and correlated with real CPU/memory data for near-real demo behavior.

5. API Data Model (Phase 2)

Top-level fields from `GET /api/processes` include:

current_user, count, mem_total_kb,
cpu_user_percent, cpu_system_percent, cpu_idle_percent,
mem_used_kb, app_memory_kb, wired_memory_kb, compressed_memory_kb,
cached_files_kb, swap_used_kb, processes[]

Each process object includes:

pid, name, user, state,
threads, cpu_time_sec,
vmsize_kb, vmrss_kb,
cpu_percent, mem_percent

6. Phase-2 Working Flow

Frontend requests `/api/processes` every refresh cycle.

Backend gathers process list + system metrics.

Backend sends calibrated JSON to frontend.

Frontend renders tab-specific table, pagination, and graphs.

User can inspect details or terminate allowed processes.

7. Validation Status

Backend compiles successfully using `make`.

Frontend production build passes using `npm run build`.

Kill-process flow remains functional.

8. Known Limitations

CPU, Memory, and Threads are now real and close to monitor tools.

Energy, Disk, and Network process-level values are still approximated (not fully native counters yet).

Exact 1:1 match with macOS Activity Monitor is not guaranteed due different sampling/internal OS logic.

9. Phase-2 Outcome

Phase 2 produced a much more mentor-ready Task Manager clone with:

Near-real system values for major metrics.

Professional multi-tab UI behavior.

Scalable table handling through pagination + scrolling.

Clear architecture linking OS metrics -> API -> frontend visualization.

10. Suggested Next Step (Phase 3)

Replace approximated Energy/Disk/Network values with native OS counters.

Add historical metric logging/export for report evidence.

Add threshold-based alerts and trend analysis.


## Abstract
This report presents the design and implementation of a cross-platform task manager clone developed as an Operating Systems mini project. The system provides near real-time process monitoring and controlled process termination through a C-based backend and a React-based frontend. The backend exposes REST APIs that collect process metadata (PID, name, user, state), resource usage (CPU, memory, threads, CPU time), and system-level metrics (CPU user/system/idle split, memory and swap statistics). The frontend renders an Activity Monitor style interface with multi-tab views (CPU, Memory, Energy, Disk, Network), search, sorting, pagination, process inspection, and interactive charts. The project demonstrates core OS concepts including process table traversal, parsing kernel-exported runtime data, signal-based process control, and cross-platform fallback strategy for Linux and macOS. Experimental observations show that core metrics (CPU, memory, thread count) are close to native monitor values, while Energy/Disk/Network per-process values are currently modeled estimates. The final system is suitable for academic demonstration and foundational OS learning.

**Keywords**—Operating Systems, Process Management, System Calls, Signals, Process Monitoring, C Programming, React, REST API.

---

## I. Introduction
Process management is a fundamental responsibility of an operating system. A practical understanding of process lifecycle, scheduling effects, and resource usage requires tools that can observe and control running processes. Native utilities such as Task Manager (Windows), Activity Monitor (macOS), and top/htop (Linux) provide this capability, but implementing a simplified clone helps students directly understand how process data is exposed by the OS and how control actions are performed.

This project implements a task manager clone with two major goals: (1) collect and display meaningful runtime process metrics, and (2) allow safe termination of selected processes through OS signaling. The implementation intentionally uses C for backend logic to stay close to operating system interfaces and React for modern visualization.

---

## II. Problem Statement and Objectives
### A. Problem Statement
Develop an Operating Systems mini project that monitors active processes in near real-time and performs user-requested process control through a clean, interactive UI.

### B. Objectives
1. Enumerate active processes and display essential process metadata.
2. Show CPU, memory, and thread-related process statistics with acceptable proximity to native monitor tools.
3. Provide process termination through signal-based API calls.
4. Build a tab-driven monitoring UI (CPU/Memory/Energy/Disk/Network) with pagination, search, sorting, and charts.
5. Support multiple host environments using Linux-first data collection and macOS fallback parsing.

---

## III. System Architecture
The system follows a two-tier design.

### A. Backend (C HTTP Server)
- Language: C
- Binary: `taskd`
- Port: `8080`
- Responsibility:
  - Collect process and system metrics.
  - Serve JSON APIs.
  - Execute process control actions (terminate/spawn demo task).

### B. Frontend (React + Vite)
- Language: JavaScript/JSX
- Port: `5173` (dev)
- Responsibility:
  - Consume backend APIs.
  - Render full-screen Activity Monitor-like UI.
  - Implement tab switching, sorting, filtering, pagination, details modal, and graph panels.

### C. Data Flow
1. Frontend calls `GET /api/processes` at initial load and periodic refresh.
2. Backend reads OS process/system sources and returns JSON.
3. Frontend computes derived metrics and renders table + charts.
4. User actions invoke control APIs (`POST /api/kill`, `POST /api/spawn-demo-task`).

---

## IV. API Specification
### A. `GET /api/processes`
Returns:
- Top-level system fields:
  - `current_user`, `count`, `mem_total_kb`
  - `cpu_user_percent`, `cpu_system_percent`, `cpu_idle_percent`
  - `mem_used_kb`, `app_memory_kb`, `wired_memory_kb`, `compressed_memory_kb`
  - `cached_files_kb`, `swap_used_kb`
- `processes[]` list with:
  - `pid`, `name`, `user`, `state`
  - `threads`, `cpu_time_sec`
  - `vmsize_kb`, `vmrss_kb`, `cpu_percent`, `mem_percent`

### B. `POST /api/kill`
Input JSON: `{ "pid": <int> }`  
Action: `kill(pid, SIGTERM)`  
Output: success or errno-based failure (`EPERM`, `ESRCH`, etc.).

### C. `POST /api/spawn-demo-task`
Action: backend forks and executes `sleep 600` for controlled demo.  
Output: started PID in JSON.

---

## V. Algorithms and Methodology
### A. Process Enumeration Algorithm
- Linux path: iterate `/proc` directories containing numeric names.
- For each PID:
  - Parse `/proc/<pid>/stat` for CPU timing and state.
  - Parse `/proc/<pid>/status` for memory, UID, thread count.
- macOS fallback path: parse `ps` output for process rows.

**Complexity:** `O(P)` where `P` is number of processes.

### B. CPU Utilization Computation
For each process (Linux):
- `total_time = (utime + stime) / ticks_per_sec`
- `lifetime = uptime - starttime/ticks_per_sec`
- `cpu_percent = (total_time / lifetime) * 100 / cpu_count`

System CPU split (Linux):
- Sample `/proc/stat` and compute delta between consecutive snapshots.
- Convert delta user/system/idle ticks to percentages.

### C. Memory and Thread Metrics
- Process memory%:
  - `mem_percent = vmrss_kb * 100 / mem_total_kb`
- Thread count:
  - Linux: parsed from `/proc/<pid>/status` (`Threads`).
  - macOS fallback: aggregate thread rows from `ps -M -ax` by PID.

### D. Sorting, Filtering, and Pagination
On frontend:
1. Apply search and user filters.
2. Sort by active tab’s default key (CPU/Memory/Energy/Disk/Network).
3. Paginate using `slice(start, start + pageSize)`.

**Complexities:**
- Filter: `O(P)`
- Sort: `O(P log P)`
- Page extraction: `O(pageSize)`

### E. Process Control Algorithm
- Validate PID and ownership constraints at UI level.
- Send kill request to backend.
- Backend applies `SIGTERM` and returns success/failure JSON.

### F. Demo Task Lifecycle Algorithm
- Start: `fork()` then `execlp("sleep", "sleep", "600", NULL)`.
- Track PID in frontend state.
- Stop: terminate tracked PID via standard kill endpoint.
- Child cleanup support is enabled through `SIGCHLD` handling.

---

## VI. Implementation Details
### A. Major Source Files
- Backend core: `/Users/sugatathawale/Documents/Operating system project/backend/server.c`
- Backend build script: `/Users/sugatathawale/Documents/Operating system project/backend/Makefile`
- Frontend app logic: `/Users/sugatathawale/Documents/Operating system project/frontend/src/App.jsx`
- Frontend styling and layout: `/Users/sugatathawale/Documents/Operating system project/frontend/src/styles.css`

### B. Platform-Aware Data Collection
- Linux:
  - `/proc` (`stat`, `status`, `meminfo`, `proc/stat`)
- macOS:
  - `ps`, `top`, `vm_stat`, `sysctl`

### C. UI Functional Modules
1. Tab switching between CPU/Memory/Energy/Disk/Network.
2. Dynamic column mapping per tab.
3. Search and user-only toggle.
4. Pagination controls (First/Prev/Next/Last + rows per page).
5. Process details modal.
6. Footer charts (CPU load, memory pressure, sparkline trends).

---

## VII. Experimental Setup and Results
### A. Setup
- Backend compiled via `make`.
- Frontend built and run through Vite.
- Periodic polling used for near real-time updates.

### B. Functional Validation
1. **Process Listing:** successful for live process set.
2. **Sorting/Filtering/Pagination:** functional across tabs.
3. **Thread Counts:** integrated from backend into UI.
4. **Kill Flow:** working with permission-aware behavior.
5. **Demo Task Run/Terminate:** API and UI integration implemented.

### C. Accuracy Discussion
- **High-confidence near-real fields:** PID, user, state, CPU%, memory%, RSS, VSZ, threads, CPU time, system memory/swap totals.
- **Modeled/derived fields (current phase):** Energy impact, per-process Disk/Network rates, GPU proxy metrics.

---

## VIII. Limitations
1. Exact 1:1 match with native Activity Monitor is not guaranteed due different OS sampling windows and internal formulas.
2. macOS fallback relies on command parsing, which can vary across OS versions.
3. Per-process Energy/Disk/Network values are currently approximations.
4. No persistent historical storage for long-duration trend analytics yet.

---

## IX. Conclusion
The project successfully demonstrates an end-to-end Operating Systems application that links low-level process introspection with an interactive monitoring interface. It validates practical understanding of process metadata extraction, CPU/memory accounting, signal-driven process control, and cross-platform adaptation strategies. The system is suitable for mentor/viva demonstration and can serve as a strong base for advanced performance analytics features.

---

## X. Future Work
1. Replace modeled Energy/Disk/Network values with native OS counters where available.
2. Add process history logging and export (CSV/JSON) for report-backed evidence.
3. Add alert engine for threshold breaches and anomaly detection.
4. Add role-based safeguards and authentication for restricted control operations.
5. Integrate optional scheduler-focused experiments (e.g., niceness/priority adjustments under supervision).

---

## References
[1] M. Kerrisk, *The Linux Programming Interface*, No Starch Press, 2010.  
[2] Linux manual page, “proc(5) — process information pseudo-filesystem.”  
[3] Linux manual page, “kill(2) — send signal to a process.”  
[4] Linux manual page, “signal(7) — overview of signals.”  
[5] Apple Developer Documentation, “sysctl and system configuration interfaces.”  
[6] Apple macOS command references: `ps(1)`, `top(1)`, `vm_stat(1)`.  
[7] D. Bovet and M. Cesati, *Understanding the Linux Kernel*, O’Reilly Media.  
[8] IEEE Editorial Style Manual, IEEE, latest edition.

---

## Appendix A: IEEE Formatting Checklist (For Final Submission)
1. Use IEEE two-column conference format in Word/LaTeX template provided by institute.  
2. Keep title, author block, abstract, and keywords exactly in IEEE order.  
3. Number section headings with Roman numerals (I, II, III...).  
4. Use numbered references in square brackets [1], [2], ...  
5. Replace all placeholders (Institute, emails, guide details, roll numbers).  
6. Add screenshots/figures with captions as per template figure style.  
7. Export final PDF only after font embedding and pagination check.

