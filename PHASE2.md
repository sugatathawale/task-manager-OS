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
