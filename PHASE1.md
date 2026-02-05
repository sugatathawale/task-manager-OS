# Operating Systems Mini Project – Phase 1

Project: Task Manager Clone (Process Monitor in C)

## PROJECT PROPOSAL TEMPLATE
**Operating Systems Mini Project – Proposal**

**Project Title:** Task Manager Clone (Process Monitor & Controller in C)

**Student Name(s):** ____________________________

**Roll No(s):** _________________________________

**Branch / Section:** ____________________________

**Academic Year:** ______________________________

**Guide Name:** _________________________________

**1. Problem Statement**
Develop a console-based task manager clone that monitors, lists, and terminates running processes. The system should help understand how an OS exposes process information and supports process control through system calls.

**2. Objectives**
Objective 1: List active processes with PID, name, and basic usage details.
Objective 2: Monitor process status in near real-time.
Objective 3: Terminate a selected process safely using OS signals.

**3. Operating System Concepts Used**
- Process Management
- System Calls
- Signals and Inter-Process Communication
- Scheduling Basics (observed via process states)
- File System Interface (e.g., /proc on Linux)

**4. Algorithms / Techniques**
- Process Enumeration: scan process table (e.g., /proc entries) and parse metadata.
- Process Filtering/Sorting: apply simple filters (name, PID) and sort by CPU or memory.
- Process Control: send signals (SIGTERM, SIGKILL) to terminate processes.

**5. Tools & Technologies**
Language: C
Compiler: GCC (or Turbo C if required by institute)
Platform: Linux/Unix-like OS preferred (for /proc support)

**6. Expected Outcome**
A working CLI tool that displays running processes, supports filtering and sorting, and allows termination of processes. Demonstrates practical usage of OS process APIs.

Guide Approval Signature: ____________

---

## SOFTWARE REQUIREMENT SPECIFICATION (SRS)

**1. Introduction**
The project aims to implement a simple task manager clone in C for learning OS process monitoring and control. The scope includes listing processes, displaying basic metrics, and terminating processes.

**2. Functional Requirements**
- System shall list running processes with PID, name, and status.
- System shall display process details (CPU time, memory usage if available).
- System shall accept user input to select and terminate a process.
- System shall refresh the process list on user request.

**3. Non-Functional Requirements**
- Platform independent where possible; Linux-focused for /proc features.
- User friendly CLI with clear prompts and error messages.
- Deterministic output for the same snapshot in time.

**4. Constraints**
- Implemented in C.
- Console based UI.
- Depends on OS-specific interfaces (e.g., /proc on Linux).

**5. Assumptions**
- Valid user input is provided.
- Single system environment and standard user permissions.

---

## DESIGN DOCUMENT TEMPLATE

**1. System Architecture**
- **Input Module:** Reads user commands (list, filter, kill, refresh).
- **Process Collector:** Scans OS process table (/proc) and builds in-memory list.
- **Formatter/Display:** Renders process list and details in CLI.
- **Controller:** Sends signals to terminate processes.

**2. Algorithm Description**
1. Read user command.
2. If command is list/refresh:
   - Scan process entries in /proc.
   - For each PID directory, read status/stat files.
   - Build a process list in memory.
   - Display results.
3. If command is kill:
   - Validate PID input.
   - Send SIGTERM; if it fails or times out, optionally send SIGKILL.
   - Report success/failure.

**3. Flowchart**
- Placeholder for hand-drawn or software-generated flowchart.

**4. Data Structures Used**
- Arrays for process list
- Structures for process metadata (PID, name, state, CPU time, memory)

---

## FINAL PROJECT REPORT FORMAT (Future Phases)
**Chapters**
- Abstract
- Introduction
- Literature Review
- Problem Statement
- Objectives
- System Design
- Algorithm
- Implementation
- Results & Discussion
- Conclusion
- Future Enhancements
- References

---

## Further Scope (Future Enhancements)
- Add a graphical frontend (desktop or web) with charts and real-time graphs.
- Support process priority changes and CPU affinity controls.
- Cross-platform support for Windows and macOS (alternative APIs).
- Add alerts for high CPU/memory usage.
- Implement process history logging and export to CSV.
- Add user authentication for safe process control in multi-user systems.
